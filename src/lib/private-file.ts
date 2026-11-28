// Shared atomic writer for Dashboard secret files (session secret, setup token
// and backend config). A fresh 0600 temp file is renamed over the destination,
// then chmod is repeated for pre-existing files. The dedicated config directory
// is tightened to 0700 on POSIX; Windows chmod is best-effort by the platform.

import { randomBytes } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';

export async function writePrivateFileAtomic(file: string, contents: string): Promise<void> {
  const directory = path.dirname(file);
  await fs.mkdir(directory, { recursive: true, mode: 0o700 });
  await fs.chmod(directory, 0o700);
  const temp = `${file}.tmp.${process.pid}.${randomBytes(8).toString('hex')}`;
  try {
    await fs.writeFile(temp, contents, { mode: 0o600, flag: 'wx' });
    await fs.chmod(temp, 0o600);
    await fs.rename(temp, file);
    // rename replaces the inode, but keep the explicit post-update chmod as a
    // contract for platforms/filesystems with unusual mode semantics.
    await fs.chmod(file, 0o600);
  } finally {
    await fs.rm(temp, { force: true }).catch(() => {});
  }
}
