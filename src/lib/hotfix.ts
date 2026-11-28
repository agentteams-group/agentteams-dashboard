import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import { copyFile, lstat, mkdir, mkdtemp, readFile, rename, rm, statfs, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, sep } from 'node:path';
import { posix } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { createGunzip } from 'node:zlib';

const execFileAsync = promisify(execFile);

/** Application-only hotfix: no docker socket, sidecar, or cluster API. */
export const HOTFIX_MAX_BYTES = 800 * 1024 * 1024;
export const HOTFIX_DOWNLOAD_TIMEOUT_MS = 120_000;
export const HOTFIX_IDLE_TIMEOUT_MS = 30_000;
export const HOTFIX_DISK_RESERVE_BYTES = 64 * 1024 * 1024;
const CHECKSUM_MAX_BYTES = 4 * 1024;
const TAR_BLOCK_BYTES = 512;
const TAR_MAX_MEMBERS = 100_000;
const TAR_MAX_METADATA_BYTES = 1024 * 1024;

let hotfixInFlight = false;

export function claimHotfixRun(): boolean {
  if (hotfixInFlight) return false;
  hotfixInFlight = true;
  return true;
}

export function releaseHotfixRun(): void {
  hotfixInFlight = false;
}

export function resetHotfixStateForTests(): void {
  hotfixInFlight = false;
}

export interface HotfixRelease {
  tag: string;
  tarUrl: string;
  sha256Url: string;
}

/** A release without both assets is not eligible for an in-app update. */
export function selectHotfixAssets(
  release: { tag_name?: unknown; assets?: unknown },
  prefix = 'dashboard-hotfix-'
): HotfixRelease | null {
  if (typeof release.tag_name !== 'string' || release.tag_name.length === 0) return null;
  const assets = Array.isArray(release.assets) ? release.assets : [];
  let tarUrl: string | null = null;
  let sha256Url: string | null = null;
  for (const asset of assets) {
    const entry = asset as { name?: unknown; browser_download_url?: unknown };
    if (typeof entry.name !== 'string' || typeof entry.browser_download_url !== 'string') continue;
    if (entry.name.startsWith(prefix) && entry.name.endsWith('.tar.gz')) tarUrl = entry.browser_download_url;
    if (entry.name.startsWith(prefix) && entry.name.endsWith('.tar.gz.sha256')) sha256Url = entry.browser_download_url;
  }
  return tarUrl && sha256Url ? { tag: release.tag_name, tarUrl, sha256Url } : null;
}

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolvePromise(hash.digest('hex')));
  });
}

interface DiskStat {
  bavail: number;
  bsize: number;
}

export interface DownloadOptions {
  fetchImpl?: typeof fetch;
  totalTimeoutMs?: number;
  idleTimeoutMs?: number;
  signal?: AbortSignal;
  requiredFreeBytes?: number;
  statfsImpl?: (_path: string) => Promise<DiskStat>;
}

export async function assertDiskSpace(
  directory: string,
  requiredBytes: number,
  statfsImpl: (_path: string) => Promise<DiskStat> = statfs
): Promise<void> {
  const info = await statfsImpl(directory);
  const available = Number(info.bavail) * Number(info.bsize);
  if (!Number.isFinite(available) || available < requiredBytes) {
    throw new Error(`热更新磁盘空间不足（需要 ${requiredBytes} 字节，可用 ${available} 字节），已中止`);
  }
}

/** Stream with hard byte, total-time, and idle-time limits. */
export async function downloadTo(
  url: string,
  destPath: string,
  maxBytes = HOTFIX_MAX_BYTES,
  options: DownloadOptions = {}
): Promise<void> {
  const controller = new AbortController();
  const abortFromParent = () => controller.abort(options.signal?.reason);
  options.signal?.addEventListener('abort', abortFromParent, { once: true });
  const totalTimeout = setTimeout(() => controller.abort(new Error('热更新下载总超时')), options.totalTimeoutMs ?? HOTFIX_DOWNLOAD_TIMEOUT_MS);
  let idleTimeout: ReturnType<typeof setTimeout> | undefined;
  const resetIdle = () => {
    clearTimeout(idleTimeout);
    idleTimeout = setTimeout(
      () => controller.abort(new Error('热更新下载空闲超时')),
      options.idleTimeoutMs ?? HOTFIX_IDLE_TIMEOUT_MS
    );
  };
  try {
    if (options.signal?.aborted) abortFromParent();
    if (options.requiredFreeBytes) {
      await assertDiskSpace(dirname(destPath), options.requiredFreeBytes, options.statfsImpl);
    }
    const res = await (options.fetchImpl ?? fetch)(url, { signal: controller.signal });
    if (!res.ok || !res.body) throw new Error(`下载失败（HTTP ${res.status}）: ${url}`);
    const declared = Number(res.headers.get('content-length') || 0);
    if (Number.isFinite(declared) && declared > maxBytes) {
      throw new Error(`热更新包超出大小上限（${declared} > ${maxBytes}）`);
    }
    const { Readable, Transform } = await import('node:stream');
    let written = 0;
    const counter = new Transform({
      transform(chunk, _enc, cb) {
        if (controller.signal.aborted) {
          cb(controller.signal.reason instanceof Error ? controller.signal.reason : new Error('热更新下载已中止'));
          return;
        }
        written += chunk.length;
        if (written > maxBytes) {
          cb(new Error(`热更新包超出大小上限（>${maxBytes}）`));
          return;
        }
        resetIdle();
        cb(null, chunk);
      },
    });
    resetIdle();
    const bodyIter = res.body as unknown as AsyncIterable<Uint8Array>;
    let rejectAbort: ((_reason: unknown) => void) | undefined;
    const aborted = new Promise<never>((_resolve, reject) => { rejectAbort = reject; });
    const notifyAbort = () => rejectAbort?.(controller.signal.reason);
    controller.signal.addEventListener('abort', notifyAbort, { once: true });
    const iterator = bodyIter[Symbol.asyncIterator]();
    const guardedBody = async function* () {
      try {
        while (true) {
          if (controller.signal.aborted) throw controller.signal.reason;
          const result = await Promise.race([iterator.next(), aborted]);
          if (result.done) return;
          yield result.value;
        }
      } finally {
        void iterator.return?.().catch(() => {});
      }
    };
    try {
      await pipeline(Readable.from(guardedBody()), counter, createWriteStream(destPath), { signal: controller.signal });
    } finally {
      controller.signal.removeEventListener('abort', notifyAbort);
    }
  } catch (error) {
    await rm(destPath, { force: true }).catch(() => {});
    if (controller.signal.aborted && controller.signal.reason instanceof Error) throw controller.signal.reason;
    throw error;
  } finally {
    clearTimeout(totalTimeout);
    clearTimeout(idleTimeout);
    options.signal?.removeEventListener('abort', abortFromParent);
  }
}

interface TarMember {
  name: string;
  size: number;
  type: string;
  linkname: string;
}

function tarString(block: Buffer, start: number, length: number): string {
  const end = block.indexOf(0, start);
  return block.toString('utf8', start, end === -1 || end > start + length ? start + length : end);
}

function tarNumber(block: Buffer, start: number, length: number): number {
  const field = block.subarray(start, start + length);
  if (field[0] & 0x80) {
    // GNU base-256 encoding: the high bit is a marker, the next bit is sign.
    if (field[0] & 0x40) throw new Error('热更新包含负数 tar 成员大小');
    let value = 0;
    for (const [index, byte] of field.entries()) {
      const digit = index === 0 ? byte & 0x7f : byte;
      if (value > (Number.MAX_SAFE_INTEGER - digit) / 256) {
        throw new Error('热更新 tar 成员大小超出安全范围');
      }
      value = value * 256 + digit;
    }
    return value;
  }
  const text = field.toString('ascii').replace(/\0.*$/, '').trim().replace(/^0+/, '');
  if (!text) return 0;
  if (!/^[0-7]+$/.test(text)) throw new Error('热更新 tar 成员大小格式无效');
  return Number.parseInt(text, 8);
}

function parsePax(data: Buffer): Record<string, string> {
  const values: Record<string, string> = {};
  let offset = 0;
  while (offset < data.length) {
    const space = data.indexOf(0x20, offset);
    if (space === -1) throw new Error('热更新 tar PAX 头无效');
    const length = Number(data.toString('ascii', offset, space));
    if (!Number.isSafeInteger(length) || length <= 0 || offset + length > data.length) {
      throw new Error('热更新 tar PAX 长度无效');
    }
    const record = data.toString('utf8', space + 1, offset + length - 1);
    const equals = record.indexOf('=');
    if (equals <= 0) throw new Error('热更新 tar PAX 记录无效');
    const key = record.slice(0, equals);
    if (key.startsWith('GNU.sparse.')) throw new Error('热更新不允许稀疏 tar 成员');
    values[key] = record.slice(equals + 1);
    offset += length;
  }
  return values;
}

function safeArchivePath(name: string): string {
  if (!name || name.includes('\0')) throw new Error('热更新包含无效 tar 成员路径');
  const portable = name.replaceAll('\\', '/');
  if (portable.startsWith('/') || /^[A-Za-z]:/.test(portable)) {
    throw new Error(`热更新 tar 成员路径越界：${name}`);
  }
  const parts = portable.split('/');
  if (parts.includes('..')) throw new Error(`热更新 tar 成员路径穿越：${name}`);
  return parts.filter((part) => part && part !== '.').join('/') || '.';
}

function safeLinkTarget(memberName: string, target: string, hardlink: boolean): string {
  if (!target || target.includes('\0')) throw new Error('热更新包含无效 tar 链接');
  const portable = target.replaceAll('\\', '/');
  if (portable.startsWith('/') || /^[A-Za-z]:/.test(portable)) {
    throw new Error(`热更新 tar 链接越界：${target}`);
  }
  const base = hardlink ? '' : posix.dirname(memberName);
  const combined = posix.normalize(base ? `${base}/${portable}` : portable);
  if (combined === '..' || combined.startsWith('../')) throw new Error(`热更新 tar 链接越界：${target}`);
  const resolved = posix.resolve('/', combined);
  return resolved.slice(1);
}

/** Inspect the gzip tar itself before invoking the platform extractor. */
export async function inspectTar(
  tarPath: string,
  deadline = Number.POSITIVE_INFINITY
): Promise<{ members: TarMember[]; expandedBytes: number }> {
  const members: TarMember[] = [];
  const kinds = new Map<string, string>();
  let expandedBytes = 0;
  let carry = Buffer.alloc(0);
  let pendingName: string | undefined;
  let pendingLink: string | undefined;
  let globalPax: Record<string, string> = {};
  let localPax: Record<string, string> = {};
  let dataBlocksToSkip = 0;
  let pendingMetadata: { type: string; size: number; blocks: Buffer[] } | undefined;

  const finishMetadata = () => {
    if (!pendingMetadata) return;
    const data = Buffer.concat(pendingMetadata.blocks);
    if (pendingMetadata.type === 'x' || pendingMetadata.type === 'g') {
      const values = parsePax(data);
      if (pendingMetadata.type === 'g') globalPax = { ...globalPax, ...values };
      else localPax = { ...globalPax, ...values };
    } else {
      const value = data.toString('utf8').replace(/[\0\n]+$/, '');
      if (pendingMetadata.type === 'L') pendingName = value;
      else pendingLink = value;
    }
    pendingMetadata = undefined;
  };

  const consume = (block: Buffer): number => {
    if (Date.now() > deadline) throw new Error('热更新总超时');
    if (block.length !== TAR_BLOCK_BYTES || block.every((byte) => byte === 0)) return 0;
    const expected = tarNumber(block, 148, 8);
    const checksumInput = Buffer.from(block);
    checksumInput.fill(0x20, 148, 156);
    const actual = checksumInput.reduce((sum, byte) => sum + byte, 0);
    if (expected !== actual) throw new Error('热更新 tar 头校验失败');

    let size = tarNumber(block, 124, 12);
    const rawType = String.fromCharCode(block[156]);
    const type = rawType === '\0' ? '0' : rawType;
    if (type === 'x' || type === 'g' || type === 'L' || type === 'K') {
      if (size < 0 || size > TAR_MAX_METADATA_BYTES) throw new Error('热更新 tar 元数据超出上限');
      pendingMetadata = { type, size, blocks: [] };
      return Math.ceil(size / TAR_BLOCK_BYTES);
    }
    if (!['0', '5', '1', '2'].includes(type)) throw new Error(`热更新不允许 tar 成员类型：${type}`);
    const pax = { ...globalPax, ...localPax };
    localPax = {};
    if (pax.size !== undefined) {
      if (!/^\d+$/.test(pax.size)) throw new Error('热更新 tar PAX 大小无效');
      size = Number(pax.size);
      if (!Number.isSafeInteger(size) || size < 0 || size > HOTFIX_MAX_BYTES) {
        throw new Error('热更新解包大小超出上限');
      }
    }
    const rawName = pax.path ?? tarString(block, 0, 100);
    const prefix = tarString(block, 345, 155);
    const name = safeArchivePath(pendingName ?? (rawName && prefix ? `${prefix}/${rawName}` : rawName));
    const linkname = pax.linkpath ?? pendingLink ?? tarString(block, 157, 100);
    pendingName = undefined;
    pendingLink = undefined;

    const ancestors = name.split('/').slice(0, -1);
    for (let index = 1; index <= ancestors.length; index += 1) {
      const parent = ancestors.slice(0, index).join('/');
      const parentKind = kinds.get(parent);
      if (parentKind && parentKind !== '5') throw new Error(`热更新 tar 成员父路径不是目录：${parent}`);
    }
    const previousKind = kinds.get(name);
    if (previousKind && (previousKind !== '5' || type !== '5')) {
      throw new Error(`热更新 tar 成员路径冲突：${name}`);
    }
    if (members.length >= TAR_MAX_MEMBERS) throw new Error('热更新解包成员数量超出上限');
    if (type !== '5') {
      expandedBytes += size;
      if (expandedBytes > HOTFIX_MAX_BYTES) {
        throw new Error('热更新解包大小超出上限');
      }
    }
    if (type === '1' || type === '2') {
      const target = safeLinkTarget(name, linkname, type === '1');
      if (type === '1' && kinds.get(target) !== '0') throw new Error(`热更新 tar 硬链接目标无效：${linkname}`);
    }
    kinds.set(name, type);
    members.push({ name, size, type, linkname });
    return Math.ceil(size / TAR_BLOCK_BYTES);
  };

  await pipeline(createReadStream(tarPath), createGunzip(), async function* (source) {
    for await (const chunk of source) {
      if (Date.now() > deadline) throw new Error('热更新总超时');
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      carry = Buffer.concat([carry, bytes]);
      let offset = 0;
      while (offset + TAR_BLOCK_BYTES <= carry.length) {
        if (dataBlocksToSkip > 0) {
          const block = carry.subarray(offset, offset + TAR_BLOCK_BYTES);
          if (pendingMetadata) {
            const collected = pendingMetadata.blocks.reduce((total, part) => total + part.length, 0);
            pendingMetadata.blocks.push(Buffer.from(block.subarray(0, Math.min(TAR_BLOCK_BYTES, pendingMetadata.size - collected))));
          }
          dataBlocksToSkip -= 1;
          if (dataBlocksToSkip === 0) finishMetadata();
        } else {
          dataBlocksToSkip = consume(carry.subarray(offset, offset + TAR_BLOCK_BYTES));
        }
        offset += TAR_BLOCK_BYTES;
      }
      carry = carry.subarray(offset);
    }
  });
  if (dataBlocksToSkip > 0 || pendingMetadata || pendingName !== undefined || pendingLink !== undefined) {
    throw new Error('热更新 tar 文件不完整');
  }
  return { members, expandedBytes };
}

async function extractTar(
  tarPath: string,
  destDir: string,
  deadline: number,
  statfsImpl: (_path: string) => Promise<DiskStat>
): Promise<void> {
  const manifest = await inspectTar(tarPath, deadline);
  await assertDiskSpace(destDir, manifest.expandedBytes + HOTFIX_DISK_RESERVE_BYTES, statfsImpl);
  await mkdir(destDir, { recursive: true });
  // GNU tar on Windows treats C:\... as a remote host. Always pass a portable
  // relative archive path and use cwd instead of an absolute -C argument.
  let archivePath = relative(destDir, tarPath);
  let temporaryArchive: string | undefined;
  if (isAbsolute(archivePath)) {
    temporaryArchive = join(destDir, '.hotfix-input.tar.gz');
    await copyFile(tarPath, temporaryArchive);
    archivePath = basename(temporaryArchive);
  }
  try {
    await execFileAsync(
      'tar',
      ['-xzf', archivePath.split(sep).join('/'), '--no-same-owner', '--no-same-permissions'],
      { cwd: destDir, timeout: Math.max(1, deadline - Date.now()), killSignal: 'SIGKILL', maxBuffer: 1024 * 1024 }
    );
  } finally {
    if (temporaryArchive) await rm(temporaryArchive, { force: true }).catch(() => {});
  }
  for (const marker of ['server.js', join('.next', 'BUILD_ID')]) {
    if (!(await lstat(join(destDir, marker))).isFile()) throw new Error(`热更新包缺少有效构建标记：${marker}`);
  }
}

function validBuildId(buildId: string): boolean {
  return /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(buildId) && buildId !== '.' && buildId !== '..';
}

async function readCurrentBuild(dataRoot: string): Promise<string | null> {
  try {
    const buildId = (await readFile(join(dataRoot, 'current'), 'utf8')).trim();
    return validBuildId(buildId) ? buildId : null;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null;
    throw error;
  }
}

async function writePointer(dataRoot: string, name: string, buildId: string): Promise<void> {
  const temporary = join(dataRoot, `.${name}-${process.pid}-${Date.now()}.tmp`);
  await writeFile(temporary, `${buildId}\n`, { mode: 0o644 });
  await rename(temporary, join(dataRoot, name));
}

export interface ApplyHotfixOptions {
  release: HotfixRelease;
  dataRoot?: string;
  workRoot?: string;
  fetchImpl?: typeof fetch;
  statfsImpl?: (_path: string) => Promise<DiskStat>;
  totalTimeoutMs?: number;
  idleTimeoutMs?: number;
}

export interface ApplyHotfixResult {
  version: string;
  buildId: string;
  previousBuildId: string | null;
}

/** Download → verify → inspect → stage → atomically publish the current pointer. */
export async function applyHotfix(options: ApplyHotfixOptions): Promise<ApplyHotfixResult> {
  const { release } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const dataRoot = options.dataRoot ?? process.env.AGENTTEAMS_DATA_DIR ?? '/data/agentteams-dashboard';
  const versionsRoot = join(dataRoot, 'versions');
  const deadline = Date.now() + (options.totalTimeoutMs ?? HOTFIX_DOWNLOAD_TIMEOUT_MS);
  const downloadOptions: DownloadOptions = {
    totalTimeoutMs: Math.max(1, deadline - Date.now()),
    idleTimeoutMs: options.idleTimeoutMs,
    statfsImpl: options.statfsImpl,
    fetchImpl,
  };
  let workRoot = options.workRoot;
  let stagingDir: string | undefined;

  try {
    if (!release.sha256Url) throw new Error('热更新缺少 sha256 校验文件，已中止');
    await mkdir(versionsRoot, { recursive: true });
    workRoot ??= await mkdtemp(join(dataRoot, '.hotfix-work-'));
    await mkdir(workRoot, { recursive: true });
    const tarPath = join(workRoot, 'hotfix.tar.gz');
    await downloadTo(release.tarUrl, tarPath, HOTFIX_MAX_BYTES, {
      ...downloadOptions,
      requiredFreeBytes: HOTFIX_MAX_BYTES,
    });
    downloadOptions.totalTimeoutMs = Math.max(1, deadline - Date.now());

    const checksumPath = join(workRoot, 'hotfix.tar.gz.sha256');
    await downloadTo(release.sha256Url, checksumPath, CHECKSUM_MAX_BYTES, {
      ...downloadOptions,
      requiredFreeBytes: CHECKSUM_MAX_BYTES,
    });
    const checksumText = await readFile(checksumPath, 'utf8');
    const expected = checksumText.split(/\r?\n/)[0]?.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!/^[a-f0-9]{64}$/.test(expected)) throw new Error('热更新 sha256 校验文件格式无效，已中止');
    const actual = await sha256File(tarPath);
    if (actual !== expected) throw new Error('热更新包校验失败（sha256 不匹配），已中止');

    stagingDir = await mkdtemp(join(versionsRoot, '.hotfix-staging-'));
    await extractTar(tarPath, stagingDir, deadline, options.statfsImpl ?? statfs);
    const buildId = (await readFile(join(stagingDir, '.next', 'BUILD_ID'), 'utf8')).trim();
    if (!validBuildId(buildId)) throw new Error('热更新包 BUILD_ID 无效，已中止');
    const versionDir = join(versionsRoot, buildId);
    try {
      await lstat(versionDir);
      throw new Error(`热更新构建版本已存在：${buildId}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    const previousBuildId = await readCurrentBuild(dataRoot);
    await rename(stagingDir, versionDir);
    stagingDir = undefined;
    await writePointer(dataRoot, 'current', buildId);
    // All older version directories remain available; in particular the
    // previous current build is never removed by a successful update.
    return { version: release.tag, buildId, previousBuildId };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('热更新')) throw error;
    const detail = error instanceof Error ? error.message : String(error);
    if (/ENOENT|EACCES|EROFS|EPERM/i.test(detail)) {
      throw new Error(`应用目录不可写，无法应用热更新（${detail}）。请确认非 root 用户可写 /data/agentteams-dashboard 数据卷。`);
    }
    throw new Error(`热更新失败：${detail}`);
  } finally {
    if (stagingDir) await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    await rm(join(workRoot ?? '', 'hotfix.tar.gz'), { force: true }).catch(() => {});
    await rm(join(workRoot ?? '', 'hotfix.tar.gz.sha256'), { force: true }).catch(() => {});
    if (!options.workRoot && workRoot) await rm(workRoot, { recursive: true, force: true }).catch(() => {});
  }
}
