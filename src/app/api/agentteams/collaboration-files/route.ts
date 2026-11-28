import { randomUUID } from 'node:crypto';
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

function safeSegment(value: string): boolean {
  return !!value && value !== '.' && value !== '..' && !/[\/\\\x00-\x1f\x7f]/.test(value);
}

function safeRelative(path: string): boolean {
  return path === '' || path.replace(/\/$/, '').split('/').every(safeSegment);
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

const taskSourceFile = /(?:^|\/)(?:Dockerfile|Makefile|go\.(?:mod|sum)|yarn\.lock)$|\.(?:html?|css|scss|less|[cm]?js|jsx|[cm]?ts|tsx|vue|astro|svelte|py|go|rs|c|cc|cpp|h|hpp|java|kt|swift|cs|rb|php|sh|bash|sql|json|ya?ml|toml|patch|diff|bundle)$/i;

function listFiles(client: Client, bucket: string, root: string, base: string, taskRoom: boolean): Promise<StorageObject[]> {
  return new Promise((resolve, reject) => {
    const objects: StorageObject[] = [];
    const stream = client.listObjects(bucket, base, false);
    stream.on('data', obj => {
      const key = obj.prefix ?? obj.name;
      if (!key || key === base || !key.startsWith(base) || isSensitiveObjectKey(key)) return;
      if (taskRoom && !obj.prefix && taskSourceFile.test(key)) return;
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
    return NextResponse.json({ root, objects: await listFiles(client, bucket, root, base, !request.nextUrl.searchParams.has('team')) });
  } catch {
    return error(key === null ? '无法读取文件列表' : '无法读取该文件', 502);
  }
}

export async function POST(request: NextRequest) {
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
  try {
    const file = (await request.formData()).get('file');
    if (!(file instanceof File) || !safeSegment(file.name)) return error('文件名无效', 400);
    const dir = prefix ? prefix.replace(/\/$/, '') + '/' : '';
    const key = `${dir}${attachment ? `${randomUUID()}-` : ''}${file.name}`;
    const object = `teams/${team.teamName || team.name}/shared/${key}`;
    if (isSensitiveObjectKey(object)) return error('不支持保存到此路径', 400);
    await createMinioClient().putObject(bucket, object, Buffer.from(await file.arrayBuffer()), file.size, {
      'content-type': file.type || 'application/octet-stream',
    });
    return NextResponse.json({ key });
  } catch {
    return error('保存团队文件失败', 502);
  }
}
