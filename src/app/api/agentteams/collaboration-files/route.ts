import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdtemp, open, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { NextRequest, NextResponse } from 'next/server';
import type { Client } from 'minio';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { readServerIdentity } from '@/lib/server-auth';
import { isSensitiveObjectKey } from '@/lib/sensitive-files';
import type { StorageObject, TeamResponse } from '@/lib/agentteams-api';
import type { WorkflowResponse } from '@/lib/agentteams-projects-api';
import { belongsToTeam, CHAT_ATTACHMENT_DIRECTORY } from '@/lib/collaboration-files';
import type { IndexedTask } from '@/hooks/use-projects';
import { getControllerUrl, proxyToAgentTeams } from '../proxy-helper';

function error(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_ATTACHMENT_TEAM_QUOTA_BYTES = 200 * 1024 * 1024;
export const CHAT_ATTACHMENT_TENANT_QUOTA_BYTES = 1024 * 1024 * 1024;
const MULTIPART_OVERHEAD_BYTES = 1024 * 1024;
const MAX_MULTIPART_HEADER_BYTES = 8192;
const MAX_MULTIPART_PARTS = 4;

class UploadError extends Error {
  readonly status: number;
  constructor(message: string, status: number) { super(message); this.status = status; }
}

// Serialize quota check + upload in this Dashboard process so concurrent
// chunked requests cannot all spend the same remaining quota.
let uploadQueue: Promise<unknown> = Promise.resolve();
async function withUploadLock<T>(work: () => Promise<T>): Promise<T> {
  const previous = uploadQueue;
  let release!: () => void;
  uploadQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try { return await work(); } finally { release(); }
}

function safeSegment(value: string): boolean {
  return !!value && value !== '.' && value !== '..' && !/[\/\\\x00-\x1f\x7f]/.test(value);
}

function safeRelative(path: string): boolean {
  return path === '' || path.replace(/\/$/, '').split('/').every(safeSegment);
}

interface SpooledUpload {
  directory: string;
  path: string;
  name: string;
  size: number;
  contentType: string;
}

class MultipartCursor {
  private buffer = Buffer.alloc(0);
  private ended = false;

  private readonly reader: ReadableStreamDefaultReader<Uint8Array>;
  private readonly countBytes: (_size: number) => void;

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>, countBytes: (_size: number) => void) {
    this.reader = reader;
    this.countBytes = countBytes;
  }

  private async fill(): Promise<boolean> {
    if (this.ended) return this.buffer.length > 0;
    const { done, value } = await this.reader.read();
    if (done) { this.ended = true; return this.buffer.length > 0; }
    this.countBytes(value.byteLength);
    this.buffer = this.buffer.length ? Buffer.concat([this.buffer, value]) : Buffer.from(value);
    return true;
  }

  private consume(size: number): void {
    this.buffer = this.buffer.subarray(size);
  }

  async until(delimiter: Buffer, sink?: (_chunk: Buffer) => Promise<void>, captureLimit = 0): Promise<Buffer> {
    const captured: Buffer[] = [];
    let capturedBytes = 0;
    for (;;) {
      if (!await this.fill()) throw new UploadError('multipart 请求不完整', 400);
      const index = this.buffer.indexOf(delimiter);
      if (index >= 0) {
        const before = this.buffer.subarray(0, index);
        if (before.length) {
          if (sink) await sink(before);
          else if (captureLimit) {
            capturedBytes += before.length;
            if (capturedBytes > captureLimit) throw new UploadError('multipart 请求头过大', 400);
            captured.push(Buffer.from(before));
          }
        }
        this.consume(index + delimiter.length);
        return Buffer.concat(captured);
      }
      // Retain a possible delimiter prefix split across network chunks.
      const flushSize = Math.max(0, this.buffer.length - delimiter.length + 1);
      if (flushSize > 0) {
        const chunk = this.buffer.subarray(0, flushSize);
        if (sink) await sink(chunk);
        else if (captureLimit) {
          capturedBytes += chunk.length;
          if (capturedBytes > captureLimit) throw new UploadError('multipart 请求头过大', 400);
          captured.push(Buffer.from(chunk));
        }
        this.consume(flushSize);
      }
    }
  }

  async exactly(size: number): Promise<Buffer> {
    const parts: Buffer[] = [];
    let remaining = size;
    while (remaining > 0) {
      if (!await this.fill()) throw new UploadError('multipart 请求不完整', 400);
      const take = Math.min(remaining, this.buffer.length);
      parts.push(Buffer.from(this.buffer.subarray(0, take)));
      this.consume(take);
      remaining -= take;
    }
    return Buffer.concat(parts);
  }

  /** Count the complete request body and reject undeclared multipart epilogues. */
  async finish(): Promise<void> {
    if (this.buffer.length) throw new UploadError('multipart 边界后存在多余数据', 400);
    for (;;) {
      const { done, value } = await this.reader.read();
      if (done) return;
      this.countBytes(value.byteLength);
      if (value.byteLength) throw new UploadError('multipart 边界后存在多余数据', 400);
    }
  }
}

function multipartBoundary(request: NextRequest): string {
  const contentType = request.headers.get('content-type') ?? '';
  const match = /^multipart\/form-data\s*;.*\bboundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  const boundary = match?.[1] ?? match?.[2];
  if (!boundary || boundary.length > 200 || !/^[\x20-\x7e]+$/.test(boundary)) {
    throw new UploadError('请求须为有效的 multipart/form-data', 400);
  }
  return boundary;
}

function dispositionValues(header: string): { name: string; filename?: string } {
  const utf8 = /\bfilename\*=UTF-8''([^;]+)/i.exec(header)?.[1];
  const plain = /\bfilename="([^"]*)"/i.exec(header)?.[1] ?? /\bfilename=([^;]+)/i.exec(header)?.[1];
  const filename = utf8 ? decodeURIComponent(utf8) : plain;
  if (filename && /[\\/\x00-\x1f\x7f]/.test(filename)) throw new UploadError('文件名无效', 400);
  return {
    name: /\bname="([^"]*)"/i.exec(header)?.[1] ?? /\bname=([^;]+)/i.exec(header)?.[1] ?? '',
    filename,
  };
}

/** Parse one file with bounded headers/bytes and spool to disk, never FormData/arrayBuffer. */
async function spoolMultipartFile(request: NextRequest): Promise<SpooledUpload> {
  const boundary = multipartBoundary(request);
  if (!request.body) throw new UploadError('请求体为空', 400);
  const reader = request.body.getReader();
  let requestBytes = 0;
  const counted = new MultipartCursor(reader, (size) => {
    requestBytes += size;
    if (requestBytes > CHAT_ATTACHMENT_MAX_BYTES + MULTIPART_OVERHEAD_BYTES) {
      throw new UploadError('上传请求超过 11MB 上限', 413);
    }
  });
  const directory = await mkdtemp(join(tmpdir(), 'agentteams-chat-'));
  let file: Awaited<ReturnType<typeof open>> | undefined;
  let result: SpooledUpload | undefined;
  let parts = 0;
  try {
    const delimiter = Buffer.from(`--${boundary}`);
    await counted.until(delimiter);
    for (;;) {
      const ending = (await counted.exactly(2)).toString('ascii');
      if (ending === '--') { await counted.exactly(2); await counted.finish(); break; }
      if (ending !== '\r\n') throw new UploadError('multipart 边界无效', 400);
      parts += 1;
      if (parts > MAX_MULTIPART_PARTS) throw new UploadError('multipart 字段过多', 400);
      const headerLines: string[] = [];
      let headerBytes = 0;
      for (;;) {
        const line = (await counted.until(Buffer.from('\r\n'), undefined, MAX_MULTIPART_HEADER_BYTES)).toString('utf8');
        headerBytes += line.length + 2;
        if (headerBytes > MAX_MULTIPART_HEADER_BYTES) throw new UploadError('multipart 请求头过大', 400);
        if (!line) break;
        headerLines.push(line);
      }
      const disposition = headerLines.find((line) => /^content-disposition:/i.test(line));
      if (!disposition) throw new UploadError('multipart 缺少 Content-Disposition', 400);
      const fields = dispositionValues(disposition);
      const contentType = headerLines.find((line) => /^content-type:/i.test(line))?.split(':').slice(1).join(':').trim();
      if (fields.name !== 'file' || fields.filename === undefined) {
        await counted.until(Buffer.from(`\r\n${delimiter}`));
        continue;
      }
      if (result || !safeSegment(fields.filename)) throw new UploadError('文件名无效', 400);
      const path = join(directory, 'upload');
      file = await open(path, 'wx');
      let size = 0;
      await counted.until(Buffer.from(`\r\n${delimiter}`), async (chunk) => {
        size += chunk.length;
        if (size > CHAT_ATTACHMENT_MAX_BYTES) throw new UploadError('单个聊天附件超过 10MB 上限', 413);
        await file!.write(chunk);
      });
      result = {
        directory,
        path,
        name: fields.filename,
        size,
        contentType: contentType && /^[\w.+-]+\/[\w.+-]+$/.test(contentType)
          ? contentType
          : 'application/octet-stream',
      };
    }
    if (!result) throw new UploadError('缺少 file 字段', 400);
    await file?.close();
    file = undefined;
    return result;
  } catch (err) {
    await reader.cancel().catch(() => undefined);
    await file?.close().catch(() => undefined);
    await rm(directory, { recursive: true, force: true }).catch(() => undefined);
    if (err instanceof UploadError) throw err;
    if (err instanceof URIError) throw new UploadError('文件名编码无效', 400);
    throw err;
  } finally {
    reader.releaseLock();
  }
}

async function attachmentUsage(client: Client, bucket: string, prefix: string, tenant = false): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    let total = 0;
    const stream = client.listObjects(bucket, prefix, true);
    stream.on('data', (object: { name?: string; size?: number }) => {
      if (typeof object.name !== 'string') return;
      if (tenant && !object.name.includes(`/shared/${CHAT_ATTACHMENT_DIRECTORY}`)) return;
      total += object.size ?? 0;
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(total));
  });
}

async function controllerGet<T>(request: NextRequest, path: string): Promise<T | NextResponse> {
  const response = await proxyToAgentTeams(request, getControllerUrl(request), path, { method: 'GET', forwardBody: false });
  return response.ok ? await response.json() as T : response;
}

async function resolveTeam(request: NextRequest, name: string) {
  if (!safeSegment(name)) return error('团队无效', 400);
  const data = await controllerGet<{ teams: TeamResponse[] }>(request, '/api/v1/teams');
  if (data instanceof NextResponse) return data;
  const team = data.teams.find(team => team.name === name);
  if (!team) return error('团队不存在或无访问权限', 404);
  return safeSegment(team.teamName || team.name) ? team : error('团队文件目录无效', 400);
}

function taskRoot(team: string | undefined, kind: 'tasks' | 'projects', id: string) {
  return safeSegment(id) && (!team || safeSegment(team))
    ? `${team ? `teams/${team}/` : ''}shared/${kind}/${id}/` : null;
}

async function resolveRoot(request: NextRequest): Promise<string | NextResponse> {
  const teamName = request.nextUrl.searchParams.get('team');
  if (teamName !== null) {
    const team = await resolveTeam(request, teamName);
    return team instanceof NextResponse ? team : `teams/${team.teamName || team.name}/shared/`;
  }
  const room = request.nextUrl.searchParams.get('room') || '';
  const id = request.nextUrl.searchParams.get('taskId') || '';
  if (!/^![^:\s]+:[^\s/]+$/.test(room)) return error('任务房间无效', 400);
  const data = await controllerGet<{ tasks: IndexedTask[] }>(request, '/api/v1/tasks');
  if (data instanceof NextResponse) return data;
  const matchesRoom = (value?: string) => value?.replace(/^room:/, '') === room;
  const main = data.tasks.find(task => task.task_id === task.main_task_id && matchesRoom(task.room_id));
  if (main) return taskRoot(main.team_id, 'tasks', main.task_id) ?? error('任务目录无效', 400);

  // Older project tasks only expose their room on workflow task details.
  if (safeSegment(id)) {
    const candidates = new Map(data.tasks.filter(task => task.project_id && (task.task_id === id || task.project_id === id))
      .map(task => [JSON.stringify([task.team_id, task.project_id]), task]));
    for (const task of candidates.values()) {
      const query = new URLSearchParams({ includeTasks: 'true' });
      if (task.team_id) query.set('teamId', task.team_id);
      const workflow = await controllerGet<WorkflowResponse>(request, `/api/v1/projects/${encodeURIComponent(task.project_id!)}/workflow?${query}`);
      if (workflow instanceof NextResponse) continue;
      const details = workflow.tasks_detail ?? [];
      if (workflow.project_id === id && details.some(detail => matchesRoom(detail.room_id))) {
        return taskRoot(task.team_id, 'projects', id) ?? error('项目目录无效', 400);
      }
      if (details.some(detail => detail.task_id === id && matchesRoom(detail.room_id))) {
        return taskRoot(task.team_id, 'tasks', id) ?? error('任务目录无效', 400);
      }
    }
  }
  return error('尚未找到此房间的任务目录', 404);
}

function listFiles(client: Client, bucket: string, root: string, base: string): Promise<StorageObject[]> {
  return new Promise((resolve, reject) => {
    const objects: StorageObject[] = [];
    const stream = client.listObjects(bucket, base, false);
    stream.on('data', obj => {
      const key = obj.prefix ?? obj.name;
      if (!key || key === base || !key.startsWith(base) || isSensitiveObjectKey(key)) return;
      objects.push({ key: key.slice(root.length), size: obj.size ?? 0, isPrefix: !!obj.prefix });
    });
    stream.on('error', reject);
    stream.on('end', () => resolve(objects));
  });
}

export async function GET(request: NextRequest) {
  const key = request.nextUrl.searchParams.get('key');
  const prefix = request.nextUrl.searchParams.get('prefix') ?? '';
  if (!safeRelative(key ?? prefix) || (key !== null && (key === '' || key.endsWith('/')))) return error('文件路径无效', 400);
  const root = await resolveRoot(request);
  if (root instanceof NextResponse) return root;
  const bucket = getMinioBucket();
  if (!bucket) return error('文件存储未配置', 503);
  try {
    const client = createMinioClient();
    if (key !== null) {
      const object = root + key;
      if (isSensitiveObjectKey(object)) return error('文件不存在', 404);
      const stat = await client.statObject(bucket, object);
      const stream = await client.getObject(bucket, object);
      return new NextResponse(Readable.toWeb(stream) as ReadableStream, { headers: {
        'Content-Type': stat.metaData?.['content-type'] || 'application/octet-stream',
        'Content-Length': String(stat.size),
        'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(key.split('/').pop()!)}`,
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
      } });
    }
    const base = root + (prefix ? prefix.replace(/\/$/, '') + '/' : '');
    return NextResponse.json({ root, objects: await listFiles(client, bucket, root, base) });
  } catch {
    return error(key === null ? '无法读取文件列表' : '无法读取该文件', 502);
  }
}

export async function POST(request: NextRequest) {
  const maxRequestBytes = CHAT_ATTACHMENT_MAX_BYTES + MULTIPART_OVERHEAD_BYTES;
  const declared = request.headers.get('content-length');
  if (declared !== null) {
    if (!/^\d+$/.test(declared) || !Number.isSafeInteger(Number(declared))) return error('Content-Length 无效', 400);
    if (Number(declared) > maxRequestBytes) return error('上传请求超过 11MB 上限', 413);
  }
  const teamName = request.nextUrl.searchParams.get('team') || '';
  const prefix = request.nextUrl.searchParams.get('prefix') ?? '';
  if (!safeRelative(prefix)) return error('文件路径无效', 400);
  const actor = readServerIdentity(request);
  if (!actor) return error('请先登录', 401);
  const team = await resolveTeam(request, teamName);
  if (team instanceof NextResponse) return team;
  const attachment = prefix === CHAT_ATTACHMENT_DIRECTORY;
  if (attachment ? !belongsToTeam(team, actor.name) : actor.level < 3) return error('无权保存到此团队目录', 403);
  const bucket = getMinioBucket();
  if (!bucket) return error('文件存储未配置', 503);

  let spool: SpooledUpload | undefined;
  try {
    return await withUploadLock(async () => {
      const client = createMinioClient();
      const teamRoot = `teams/${team.teamName || team.name}/shared/`;
      const attachmentPrefix = `${teamRoot}${CHAT_ATTACHMENT_DIRECTORY}`;
      const [teamUsed, tenantUsed] = attachment
        ? await Promise.all([
          attachmentUsage(client, bucket, attachmentPrefix),
          attachmentUsage(client, bucket, 'teams/', true),
        ])
        : [0, 0];
      if (teamUsed >= CHAT_ATTACHMENT_TEAM_QUOTA_BYTES || tenantUsed >= CHAT_ATTACHMENT_TENANT_QUOTA_BYTES) {
        throw new UploadError('聊天附件配额已用尽', 413);
      }

      spool = await spoolMultipartFile(request);
      if (attachment && (
        teamUsed + spool.size > CHAT_ATTACHMENT_TEAM_QUOTA_BYTES ||
        tenantUsed + spool.size > CHAT_ATTACHMENT_TENANT_QUOTA_BYTES
      )) throw new UploadError('聊天附件超出团队或租户配额', 413);

      const dir = prefix ? prefix.replace(/\/$/, '') + '/' : '';
      const key = `${dir}${attachment ? `${randomUUID()}-` : ''}${spool.name}`;
      const object = `teams/${team.teamName || team.name}/shared/${key}`;
      if (isSensitiveObjectKey(object)) return error('不支持保存到此路径', 400);
      try {
        await client.putObject(bucket, object, createReadStream(spool.path), spool.size, {
          'content-type': spool.contentType,
        });
      } catch (err) {
        await client.removeObject(bucket, object).catch(() => undefined);
        throw err;
      }
      return NextResponse.json({ key });
    });
  } catch (err) {
    if (err instanceof UploadError) return error(err.message, err.status);
    return error('保存团队文件失败', 502);
  } finally {
    if (spool) await rm(spool.directory, { recursive: true, force: true }).catch(() => undefined);
  }
}
