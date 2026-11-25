import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from './api-error';
import {
  describeHumanFileError,
  encodeHumanFilePath,
  formatFileSize,
  humanBreadcrumbs,
  humanFileDownloadUrl,
  humanFilesApiPath,
  joinHumanDir,
  normalizeTrashEntries,
  parentHumanDir,
} from './human-files-api';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('human file paths', () => {
  it('encodes each segment but keeps / separators and drops empty segments', () => {
    expect(encodeHumanFilePath('/docs//报告 2026/a+b%20.md/')).toBe(
      'docs/%E6%8A%A5%E5%91%8A%202026/a%2Bb%2520.md',
    );
    expect(encodeHumanFilePath('')).toBe('');
  });

  it('builds the proxy path, and the download URL carries the base path without a trailing slash', () => {
    expect(humanFilesApiPath('alice')).toBe('/api/agentteams/humans/alice/files');
    expect(humanFilesApiPath('alice', 'docs/a.md')).toBe(
      '/api/agentteams/humans/alice/files/docs/a.md',
    );

    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/dashboard');
    expect(humanFileDownloadUrl('alice', 'docs/报告.md')).toBe(
      '/dashboard/api/agentteams/humans/alice/files/docs/%E6%8A%A5%E5%91%8A.md',
    );
    // A trailing slash would mean "list this directory" to the controller.
    expect(humanFileDownloadUrl('alice', 'docs/a.md').endsWith('/')).toBe(false);
  });

  it('derives breadcrumbs, parents and child paths', () => {
    expect(humanBreadcrumbs('docs/2026/q4')).toEqual([
      { label: '文件', path: '' },
      { label: 'docs', path: 'docs' },
      { label: '2026', path: 'docs/2026' },
      { label: 'q4', path: 'docs/2026/q4' },
    ]);
    expect(humanBreadcrumbs('')).toEqual([{ label: '文件', path: '' }]);
    expect(parentHumanDir('docs/2026/q4')).toBe('docs/2026');
    expect(parentHumanDir('docs')).toBe('');
    expect(joinHumanDir('docs', 'a.md')).toBe('docs/a.md');
    expect(joinHumanDir('', 'a.md')).toBe('a.md');
  });
});

describe('error mapping (W4 semantics)', () => {
  it('separates an explicit denial from the deliberately indistinguishable 404', () => {
    const denied = describeHumanFileError(new ApiError('forbidden', 403, '/files'));
    expect(denied.kind).toBe('forbidden');
    expect(denied.message).toContain('无权限');

    const hidden = describeHumanFileError(new ApiError('not found', 404, '/files'));
    expect(hidden.kind).toBe('hidden');
    expect(hidden.message).toBe('不存在或不可见');

    const other = describeHumanFileError(new ApiError('boom', 500, '/files'));
    expect(other.kind).toBe('error');
  });
});

describe('trash mapping', () => {
  it('strips the files/ prefix, coerces fields and orders newest first', () => {
    const mapped = normalizeTrashEntries({
      entries: [
        {
          id: '20260101T100000Z-aaaa',
          path: 'files/docs/a.md',
          size: 2048,
          deletedAt: '2026-01-01T10:00:00Z',
          caller: 'alice',
          role: 'admin',
        },
        { id: '20260202T100000Z-bbbb', path: 'files/b.md', size: 10, deletedAt: '2026-02-02T10:00:00Z' },
        null,
        { id: '' },
      ],
    });
    expect(mapped.map((entry) => entry.path)).toEqual(['b.md', 'docs/a.md']);
    expect(mapped[1]).toMatchObject({ size: 2048, caller: 'alice', role: 'admin' });
    expect(mapped[0].deletedAt).toBe('2026-02-02T10:00:00Z');
  });

  it('accepts a bare array and tolerates a missing body', () => {
    expect(normalizeTrashEntries([{ id: 'x', path: 'files/q.md' }])[0]).toMatchObject({
      id: 'x',
      path: 'q.md',
      size: 0,
    });
    expect(normalizeTrashEntries(null)).toEqual([]);
    expect(normalizeTrashEntries({})).toEqual([]);
  });
});

describe('formatFileSize', () => {
  it('scales units and degrades safely', () => {
    expect(formatFileSize(0)).toBe('0 B');
    expect(formatFileSize(1023)).toBe('1023 B');
    expect(formatFileSize(2048)).toBe('2.0 KB');
    expect(formatFileSize(15 * 1024 * 1024)).toBe('15 MB');
    expect(formatFileSize(Number.NaN)).toBe('-');
  });
});
