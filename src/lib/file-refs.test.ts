import { describe, expect, it } from 'vitest';
import { FILE_REFS_CONTENT_KEY, parseFileRefs, type FileRef } from '@/lib/file-refs';

describe('parseFileRefs', () => {
  it('parses the { refs: [...] } envelope and defaults the name to the basename', () => {
    const refs = parseFileRefs({
      refs: [{ key: 'agents/worker-a/notes.md', size: 2048 }],
    });

    expect(refs).toHaveLength(1);
    expect(refs[0]).toEqual<FileRef>({ name: 'notes.md', key: 'agents/worker-a/notes.md', size: 2048 });
  });

  it('accepts a bare array and drops malformed entries', () => {
    const refs = parseFileRefs([
      { name: 'a.txt', key: 'a.txt' },
      { name: 'no-key' },
      null,
      'nope',
      { key: 'b.txt', name: 'b.txt' },
    ]);

    expect(refs.map((r) => r.key)).toEqual(['a.txt', 'b.txt']);
  });

  it('returns an empty list for missing or malformed payloads', () => {
    expect(parseFileRefs(undefined)).toEqual([]);
    expect(parseFileRefs(null)).toEqual([]);
    expect(parseFileRefs(42)).toEqual([]);
    expect(parseFileRefs({ refs: 'nope' })).toEqual([]);
    expect(parseFileRefs({ other: [] })).toEqual([]);
  });

  it('caps the number of refs and truncates long names', () => {
    const many = Array.from({ length: 50 }, (_, i) => ({ key: `f${i}.txt` }));
    expect(parseFileRefs({ refs: many })).toHaveLength(20);

    const longName = parseFileRefs({ refs: [{ key: 'x.txt', name: 'n'.repeat(500) }] });
    expect(longName[0].name).toHaveLength(256);
  });

  it('ignores non-finite sizes', () => {
    const refs = parseFileRefs({ refs: [{ key: 'x.txt', size: Number.NaN }] });
    expect(refs[0].size).toBeUndefined();
  });

  it('exposes the stable content key', () => {
    expect(FILE_REFS_CONTENT_KEY).toBe('com.agentteams.file_refs');
  });
});
