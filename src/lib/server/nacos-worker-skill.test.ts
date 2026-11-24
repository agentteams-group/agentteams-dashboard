// @vitest-environment node
import { beforeEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { workerSkill } from './nacos-worker-skill';
import { openNacosSkills } from './nacos-ard';

const mock = vi.hoisted(() => ({
  objects: new Map<string, Buffer>(), restart: vi.fn(), proxy: vi.fn(), put: vi.fn(),
}));
vi.mock('@/lib/minio-client', () => ({
  getMinioBucket: () => 'test',
  createMinioClient: () => ({
    async *listObjectsV2(_bucket: string, prefix: string) {
      for (const [name, bytes] of mock.objects) if (name.startsWith(prefix)) yield { name, size: bytes.length };
    },
    async *getObject(_bucket: string, path: string) {
      const bytes = mock.objects.get(path);
      if (!bytes) throw Object.assign(new Error('missing'), { code: 'NoSuchKey' });
      yield bytes;
    },
    putObject: mock.put,
    removeObject: (_bucket: string, path: string) => mock.objects.delete(path),
  }),
}));
vi.mock('@/app/api/agentteams/proxy-helper', () => ({ getControllerUrl: () => 'http://controller', proxyToAgentTeams: mock.proxy }));
vi.mock('@/lib/worker-restart', () => ({ restartWorkerForSkillReload: mock.restart }));

const prefix = 'agents/alice/skills/review/';
const files = (v: string) => new Map([
  ['SKILL.md', Buffer.from('---\nname: review\ndescription: checklist\nversion: ' + v + '\n---\nReview changes.\n')],
  ['notes.md', Buffer.from('Checklist for ' + v)],
]);
const entry = { identifier: 'review', type: 'application/agent-skills+zip', url: '', version: '2.0.0',
  metadata: { resourceName: 'review', namespaceId: 'demo' } };
const upstream = {
  item: () => ({ source: 'registry/demo/review', name: 'review' }),
  download: vi.fn(async (_entry: typeof entry, v = entry.version) => files(v)),
};
const state = () => workerSkill(new NextRequest('http://dash/api'), 'alice', upstream as unknown as Awaited<ReturnType<typeof openNacosSkills>>, entry);
function store(v: string) {
  for (const [p, b] of files(v)) mock.objects.set(prefix + p, b);
}
function runtime(v: string) {
  mock.proxy.mockImplementation(async (_req, _base, path: string) => Response.json(path.endsWith('/skills')
    ? [{ name: 'review', enabled: true, version_text: v }] : { skills: ['review'] }));
}
beforeEach(() => {
  mock.objects.clear();
  vi.clearAllMocks();
  runtime('1.0.0');
  mock.restart.mockResolvedValue({ ok: true });
  mock.put.mockImplementation(async (_bucket, p, b) => { mock.objects.set(p, b); });
});

it('keeps the enabled runtime version observable even when its workspace baseline is unavailable', async () => {
  store('3.0.0');
  upstream.download.mockRejectedValueOnce(new Error('missing package'));
  const s = await state();
  expect(s.version).toBe('3.0.0');
  expect(s.conflict).toContain('无法核对工作区基线');
  expect((await s.runtime()).version).toBe('1.0.0');
  await expect(s.apply(s.digest)).rejects.toThrow('无法核对');
  expect(mock.put).not.toHaveBeenCalled();
});

it('preserves local edits and skips a repeated deployment of an already enabled identical package', async () => {
  store('2.0.0');
  runtime('2.0.0');
  const s = await state();
  await s.apply(s.digest);
  expect((await state()).bound).toBe(true);
  mock.put.mockClear();
  const bound = await state();
  await bound.apply(bound.digest);
  expect(mock.put).not.toHaveBeenCalled();
  expect(mock.restart).not.toHaveBeenCalled();
  mock.objects.set(prefix + 'notes.md', Buffer.from('local edit'));
  const dirty = await state();
  await expect(dirty.apply(s.digest)).rejects.toThrow('工作区已修改');
  expect(mock.put).not.toHaveBeenCalled();
});

it('resumes an interrupted deployment only when the remaining files match the recorded snapshots', async () => {
  store('1.0.0');
  const s = await state();
  mock.put.mockImplementation(async (_bucket, key, b) => {
    if (key === prefix + 'notes.md') throw new Error('storage unavailable');
    mock.objects.set(key, b);
  });
  await expect(s.apply(s.digest)).rejects.toThrow('storage unavailable');
  expect((await state()).incomplete).toBe(true);
  mock.objects.delete(prefix + 'notes.md');
  expect((await state()).conflict).toContain('上次更新未完成');
  mock.objects.set(prefix + 'notes.md', files('1.0.0').get('notes.md')!);
  mock.put.mockImplementation(async (_bucket, key, b) => { mock.objects.set(key, b); });
  const partial = await state();
  await partial.apply(partial.digest);
  expect((await state()).version).toBe('2.0.0');
  expect((await state()).incomplete).toBe(false);
  expect(mock.objects.get(prefix + 'notes.md')).toEqual(files('2.0.0').get('notes.md'));
  expect(mock.restart).toHaveBeenCalledTimes(1);
});
