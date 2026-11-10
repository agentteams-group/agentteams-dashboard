import { describe, expect, it } from 'vitest';
import { FILE_REFS_CONTENT_KEY, parseFileRefs, withFileReferences, type FileRef } from '@/lib/file-refs';

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

describe('runtime-readable workspace references', () => {
  it('includes the chosen filename, full key and owner in plain text', () => {
    const refs: FileRef[] = [{ name: '报告.md', key: 'default/docs/报告.md', workspace: { kind: 'worker', ownerName: 'default' } }];
    const body = withFileReferences('总结这个文件', refs);
    expect(body).toContain('总结这个文件');
    expect(body).toContain('default/docs/报告.md');
    expect(body).toContain('Worker工作空间 "default"');
    expect(parseFileRefs({ refs })).toEqual(refs);
  });
  it('leaves ordinary messages unchanged and supports legacy references', () => {
    expect(withFileReferences('你好')).toBe('你好');
    expect(withFileReferences('请阅读', [{ name: 'a.md', key: 'docs/a.md' }])).toContain('docs/a.md');
  });
});
