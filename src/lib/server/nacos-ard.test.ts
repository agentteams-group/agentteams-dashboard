// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';
import { unzipSync } from 'fflate';
import { openNacosSkills, publicationZip, fingerprint, compareSkillFiles, filePreview } from './nacos-ard';
import { getNacosConfig } from '@/lib/skill-center-config';
import { publishDraft } from './nacos-skill-publication';

vi.mock('@/lib/skill-center-config', () => ({ getNacosConfig: vi.fn() }));
afterEach(() => vi.unstubAllGlobals());

const original = new Map([
  ['SKILL.md', Buffer.from('---\nname: review\ndescription: Review changes\nversion: 1.2.0\n---\nReview carefully.\n')],
  ['references/checklist.md', Buffer.from('Tests\n')],
  ['assets/example.bin', Buffer.from([0, 255, 3])],
]);

it('compares the union of paths including deleted, added and binary changes', () => {
  const next = new Map(original);
  next.delete('references/checklist.md');
  next.set('notes.txt', Buffer.from(''));
  next.set('assets/example.bin', Buffer.from([0, 10, 3]));
  expect(compareSkillFiles(original, next)).toEqual([
    { path: 'assets/example.bin', change: 'modified' },
    { path: 'notes.txt', change: 'added' },
    { path: 'references/checklist.md', change: 'removed' },
  ]);
  expect(filePreview(next.get('notes.txt'))).toEqual({ size: 0, text: '' });
  expect(filePreview(next.get('references/checklist.md'))).toBeNull();
  const binary = filePreview(next.get('assets/example.bin'));
  expect(binary).toMatchObject({ size: 3, text: null, sha256: expect.stringMatching(/^[a-f0-9]{64}$/) });
  expect(binary?.sha256).not.toBe(filePreview(original.get('assets/example.bin'))?.sha256);
});

it('recognizes a missing Skill only when the native registry reports its resource-not-found code', async () => {
  vi.mocked(getNacosConfig).mockResolvedValue({ registryUrl: 'nacos://registry:8848/team', namespace: 'team' });
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ code: 20004 }, { status: 404 }))
    .mockResolvedValueOnce(Response.json({ code: 404 }, { status: 404 }))
    .mockResolvedValueOnce(new Response(null, { status: 503 }));
  vi.stubGlobal('fetch', fetcher);
  const nacos = await openNacosSkills();
  expect(await nacos.meta('review')).toBeNull();
  await expect(nacos.meta('review')).rejects.toThrow('元数据');
  await expect(nacos.meta('review')).rejects.toThrow('503');
});

it('publishes the edited workspace with a new frontmatter version and preserves binary files', () => {
  const digest = fingerprint(original);
  const zipped = publicationZip('review', original, '1.3.0', { 'references/checklist.md': 'Tests and rollback\n' });
  const files = unzipSync(zipped);
  expect(Buffer.from(files['review/SKILL.md']).toString()).toContain('version: 1.3.0');
  expect(Buffer.from(files['review/references/checklist.md']).toString()).toBe('Tests and rollback\n');
  expect(Buffer.from(files['review/assets/example.bin'])).toEqual(original.get('assets/example.bin'));
  expect(fingerprint(original)).toBe(digest);
  expect(() => publicationZip('other', original, '1.3.0', {})).toThrow('资源名称');
  expect(() => publicationZip('review', original, '1.3.0', { 'assets/example.bin': 'test' })).toThrow('UTF-8');
});

it('uses the ARD result for the selected source and refuses a foreign artifact URL', async () => {
  vi.mocked(getNacosConfig).mockResolvedValue({ registryUrl: 'nacos://registry:8848/team', namespace: 'team' });
  const entry = { identifier: 'urn:test:review', version: '1.2.0', type: 'application/agent-skills+zip',
    url: 'https://other.example/test', metadata: { namespaceId: 'team', resourceName: 'review' } };
  const fetcher = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ results: [entry] })));
  vi.stubGlobal('fetch', fetcher);
  const nacos = await openNacosSkills();
  const source = nacos.item(entry).source;
  await expect(nacos.resolve('review', source)).resolves.toEqual(entry);
  await expect(nacos.resolve('review', 'somewhere else')).rejects.toThrow('找不到');
  await expect(nacos.download(entry)).rejects.toThrow('制品 URL');
  expect(fetcher).toHaveBeenCalledTimes(2);
});

it('rejects a publish when the Nacos management API reports a newer latest than discovery', async () => {
  vi.mocked(getNacosConfig).mockResolvedValue({ registryUrl: 'nacos://registry:8848/team', namespace: 'team' });
  const fetcher = vi.fn().mockResolvedValue(Response.json({ code: 0, data: { labels: { latest: '1.4.0' }, versions: [] } }));
  vi.stubGlobal('fetch', fetcher);
  const nacos = await openNacosSkills();
  await expect(publishDraft(nacos, 'review', { source: 'review', base: '1.2.0', version: '1.3.0',
    digest: '', message: 'changes' }, null, new Uint8Array(), vi.fn())).rejects.toThrow('上游版本已改变');
  expect(fetcher).toHaveBeenCalledTimes(1);
});
