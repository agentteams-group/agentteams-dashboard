import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * In-app hot patch: download a full standalone-build bundle from the latest
 * GitHub release, verify it, swap it into place, and let the container
 * supervisor (docker restart policy / k8s restartPolicy) bring the process
 * back up on the patched files.
 *
 * Deliberately application-only: no docker socket, no sidecar, no k8s API —
 * identical behavior on docker run, compose, and k8s pods with a writable
 * root filesystem.
 */

export const HOTFIX_MAX_BYTES = 800 * 1024 * 1024;

// One patch at a time: overlapping triggers would race the directory swap.
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
  sha256Url: string | null;
}

/** Pick the hotfix bundle (+ optional checksum) from a release JSON. */
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
    if (typeof entry.name !== 'string' || typeof entry.browser_download_url !== 'string') {
      continue;
    }
    if (entry.name.startsWith(prefix) && entry.name.endsWith('.tar.gz')) {
      tarUrl = entry.browser_download_url;
    }
    if (entry.name.startsWith(prefix) && entry.name.endsWith('.tar.gz.sha256')) {
      sha256Url = entry.browser_download_url;
    }
  }
  if (!tarUrl) return null;
  return { tag: release.tag_name, tarUrl, sha256Url };
}

export async function sha256File(filePath: string): Promise<string> {
  const { createReadStream } = await import('node:fs');
  return new Promise((resolvePromise, reject) => {
    const hash = createHash('sha256');
    const stream = createReadStream(filePath);
    stream.on('data', (chunk) => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolvePromise(hash.digest('hex')));
  });
}

/** Stream a URL to a file with a hard size cap. */
export async function downloadTo(url: string, destPath: string, maxBytes = HOTFIX_MAX_BYTES): Promise<void> {
  const res = await fetch(url);
  if (!res.ok || !res.body) {
    throw new Error(`下载失败（HTTP ${res.status}）: ${url}`);
  }
  const declared = Number(res.headers.get('content-length') || 0);
  if (declared > maxBytes) {
    throw new Error(`热更新包超出大小上限（${declared} > ${maxBytes}）`);
  }
  const { Readable, Transform } = await import('node:stream');
  let written = 0;
  const counter = new Transform({
    transform(chunk, _enc, cb) {
      written += chunk.length;
      if (written > maxBytes) {
        cb(new Error(`热更新包超出大小上限（>${maxBytes}）`));
        return;
      }
      cb(null, chunk);
    },
  });
  const bodyIter = res.body as unknown as AsyncIterable<Uint8Array>;
  await pipeline(Readable.from(bodyIter), counter, createWriteStream(destPath));
}

async function firstLine(url: string, fetchImpl: typeof fetch): Promise<string | null> {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) return null;
    const text = await res.text();
    return text.split('\n')[0]?.trim().split(/\s+/)[0] ?? null;
  } catch {
    return null;
  }
}

async function extractTar(tarPath: string, destDir: string): Promise<void> {
  await mkdir(destDir, { recursive: true });
  await execFileAsync('tar', ['-xzf', tarPath, '-C', destDir]);
  // Sanity: a real standalone build has these two markers.
  await stat(join(destDir, 'server.js'));
  await stat(join(destDir, '.next', 'BUILD_ID'));
}

/**
 * Atomically-ish swap the staged build into the app directory. The previous
 * build is kept as `<appDir>.prev` for manual inspection/rollback; the
 * rename pair is the only moment where lazy module loads could observe a
 * path change, and the process exits right after anyway.
 */
export async function applyStaged(stagingDir: string, appDir: string): Promise<string> {
  const prevDir = `${appDir}.prev`;
  await rm(prevDir, { recursive: true, force: true });
  await rename(appDir, prevDir);
  try {
    await rename(stagingDir, appDir);
  } catch (error) {
    // Roll the old build back so a retry starts from a known state.
    await rename(prevDir, appDir);
    throw error;
  }
  return prevDir;
}

export interface ApplyHotfixOptions {
  release: HotfixRelease;
  appDir?: string;
  workRoot?: string;
  fetchImpl?: typeof fetch;
}

export interface ApplyHotfixResult {
  version: string;
  buildId: string;
}

/**
 * Download → verify → extract → sanity check → swap. Throws with a
 * user-presentable message on any failure; staged files are cleaned up.
 */
export async function applyHotfix(options: ApplyHotfixOptions): Promise<ApplyHotfixResult> {
  const { release } = options;
  const fetchImpl = options.fetchImpl ?? fetch;
  const appDir = options.appDir ?? process.cwd();

  const workRoot = options.workRoot ?? (await mkdtemp(join(tmpdir(), 'dashboard-hotfix-')));
  const tarPath = join(workRoot, 'hotfix.tar.gz');
  const stagingDir = join(dirname(appDir), `.hotfix-staging-${Date.now()}`);

  try {
    const res = await fetchImpl(release.tarUrl);
    if (!res.ok || !res.body) {
      throw new Error(`热更新包下载失败（HTTP ${res.status}）`);
    }
    const { Readable } = await import('node:stream');
    const bodyIter = res.body as unknown as AsyncIterable<Uint8Array>;
    await pipeline(Readable.from(bodyIter), createWriteStream(tarPath));

    if (release.sha256Url) {
      const expected = await firstLine(release.sha256Url, fetchImpl);
      if (expected) {
        const actual = await sha256File(tarPath);
        if (actual !== expected.toLowerCase()) {
          throw new Error('热更新包校验失败（sha256 不匹配），已中止');
        }
      }
    }

    await extractTar(tarPath, stagingDir);
    const buildId = (await readFile(join(stagingDir, '.next', 'BUILD_ID'), 'utf8')).trim();
    await applyStaged(stagingDir, appDir);
    return { version: release.tag, buildId };
  } catch (error) {
    await rm(stagingDir, { recursive: true, force: true }).catch(() => {});
    if (error instanceof Error && error.message.startsWith('热更新')) {
      throw error;
    }
    const detail = error instanceof Error ? error.message : String(error);
    if (/ENOENT|EACCES|EROFS|EPERM/i.test(detail)) {
      throw new Error(`应用目录不可写，无法应用热更新（${detail}）。k8s 部署需放开 readOnlyRootFilesystem。`);
    }
    throw new Error(`热更新失败：${detail}`);
  } finally {
    await rm(tarPath, { force: true }).catch(() => {});
    if (!options.workRoot) {
      await rm(workRoot, { recursive: true, force: true }).catch(() => {});
    }
  }
}
