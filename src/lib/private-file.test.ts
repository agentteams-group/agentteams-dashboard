// @vitest-environment node
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { writePrivateFileAtomic } from './private-file';

let root: string;
let file: string;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'dashboard-private-file-'));
  file = path.join(root, 'nested', 'config.json');
});

afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe('writePrivateFileAtomic', () => {
  it.skipIf(process.platform === 'win32')('creates directory 0700 and file 0600, and repairs an update', async () => {
    await writePrivateFileAtomic(file, '{"secret":"first"}\n');
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    fs.chmodSync(path.dirname(file), 0o755);
    fs.chmodSync(file, 0o644);
    await writePrivateFileAtomic(file, '{"secret":"second"}\n');
    expect(fs.statSync(path.dirname(file)).mode & 0o777).toBe(0o700);
    expect(fs.statSync(file).mode & 0o777).toBe(0o600);
    expect(fs.readFileSync(file, 'utf8')).toBe('{"secret":"second"}\n');
    expect(fs.readdirSync(path.dirname(file))).toEqual(['config.json']);
  });

  it.skipIf(process.platform === 'win32' || process.getuid?.() !== 0)(
    'a non-owner process cannot read the private config (root POSIX fixture)',
    async () => {
      await writePrivateFileAtomic(file, '{"secret":"never-readable"}\n');
      const child = spawnSync(process.execPath, ['-e', 'process.exit(require("node:fs").readFileSync(process.argv[1],"utf8") ? 0 : 1)', file], {
        uid: 65534,
        gid: 65534,
        encoding: 'utf8',
      });
      expect(child.status).not.toBe(0);
      expect(child.stdout).not.toContain('never-readable');
    },
  );

  it('leaves no temporary file when the destination cannot be replaced', async () => {
    const directoryTarget = path.join(root, 'destination');
    fs.mkdirSync(directoryTarget);
    await expect(writePrivateFileAtomic(directoryTarget, 'secret')).rejects.toBeDefined();
    expect(fs.readdirSync(root).filter((name) => name.includes('.tmp.'))).toEqual([]);
  });
});
