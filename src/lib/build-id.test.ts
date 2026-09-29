import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  getServerBuildId,
  getServerBuiltAt,
  resetBuildIdCacheForTests,
} from './build-id';

// Real-file fidelity: point BUILD_INFO_DIR at a temp dir instead of mocking
// the node builtin (builtin mocks don't reliably reach the source module).
let dir: string;

describe('lib/build-id', () => {
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'build-id-test-'));
    process.env.BUILD_INFO_DIR = dir;
    resetBuildIdCacheForTests();
  });

  afterEach(() => {
    delete process.env.BUILD_INFO_DIR;
    rmSync(dir, { recursive: true, force: true });
  });

  it('reads and trims BUILD_ID with its mtime as builtAt', () => {
    writeFileSync(join(dir, 'BUILD_ID'), 'test-build-id\n', 'utf8');
    expect(getServerBuildId()).toBe('test-build-id');
    expect(getServerBuiltAt()).toBeDefined();
  });

  it('caches per process — stable identity across calls', () => {
    writeFileSync(join(dir, 'BUILD_ID'), 'test-build-id', 'utf8');
    const first = getServerBuildId();
    // Mutating the file afterwards changes nothing: the read happens once.
    writeFileSync(join(dir, 'BUILD_ID'), 'changed-after-read', 'utf8');
    expect(getServerBuildId()).toBe(first);
  });

  it('reports unknown with a single warning when BUILD_ID is missing', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      expect(getServerBuildId()).toBe('unknown');
      expect(getServerBuiltAt()).toBeUndefined();
      getServerBuildId();
      getServerBuildId();
      expect(warn).toHaveBeenCalledTimes(1);
    } finally {
      warn.mockRestore();
    }
  });
});
