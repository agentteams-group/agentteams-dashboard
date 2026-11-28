import { ApiError } from '@/lib/api-error';
import { entryRowPath } from '@/lib/files-model';
import type { HumanFileEntry } from '@/lib/human-files-api';
import type { FileOpTarget } from './files/files-dialogs';

export async function sha256Blob(blob: Blob): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('当前浏览器无法计算文件校验值，源文件未删除');
  }
  const digest = await subtle.digest('SHA-256', await blob.arrayBuffer());
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function readStorage(key: string): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writeStorage(key: string, value: string): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(key, value);
  } catch {
    /* 隐私模式 / 配额失败忽略 */
  }
}

/** sessionUser → human 名（Matrix localpart）。 */
export function humanNameFromSession(user: string | null): string {
  if (!user) return '';
  const local = user.startsWith('@') ? user.slice(1).split(':')[0] : user;
  return local.split('@')[0] ?? local;
}

export function statusOf(err: unknown): '' | '404' | 'err' {
  if (err instanceof ApiError) {
    if (err.status === 404 || err.status === 403) return '404';
    return 'err';
  }
  return err ? 'err' : '';
}

export function entryToTarget(entry: HumanFileEntry, dirPath: string): FileOpTarget {
  return {
    path: entryRowPath(entry, dirPath),
    name: entry.name,
    isDir: entry.type === 'directory',
    size: entry.size,
  };
}
