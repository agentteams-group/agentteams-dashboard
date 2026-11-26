// @vitest-environment node
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { GET, POST } from './route';
import { enforceLevelOnlyRbac, enforceServerSideRbac } from '@/lib/server-auth';
import { openNacosSkills } from '@/lib/server/nacos-ard';
import { publicationStore } from '@/lib/server/nacos-skill-publication';

vi.mock('@/lib/server-auth', () => ({ enforceLevelOnlyRbac: vi.fn(), enforceServerSideRbac: vi.fn() }));
vi.mock('@/lib/server/nacos-ard', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/nacos-ard')>(), openNacosSkills: vi.fn(),
}));
vi.mock('@/lib/server/nacos-skill-publication', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/server/nacos-skill-publication')>(), publicationStore: vi.fn(),
}));
beforeEach(() => vi.clearAllMocks());

const post = (body: object) => POST(new NextRequest('http://localhost/api/agentteams/skills/nacos/ard',
  { method: 'POST', body: JSON.stringify(body) }));

it('requires Skill update permission before a local publication can contact Nacos', async () => {
  vi.mocked(enforceLevelOnlyRbac).mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
  expect((await post({ action: 'publish', local: true, name: 'check' })).status).toBe(403);
  expect(enforceLevelOnlyRbac).toHaveBeenCalledWith(expect.anything(), 'update', 'skill', 'check');
  expect(enforceServerSideRbac).not.toHaveBeenCalled();
  expect(openNacosSkills).not.toHaveBeenCalled();
});

it('requires access to the selected Worker before resuming its publication', async () => {
  vi.mocked(enforceServerSideRbac).mockResolvedValueOnce(NextResponse.json({}, { status: 403 }));
  expect((await post({ action: 'finish', worker: 'one', name: 'check' })).status).toBe(403);
  expect(enforceServerSideRbac).toHaveBeenCalledWith(expect.anything(), 'update', 'worker', 'one');
  expect(openNacosSkills).not.toHaveBeenCalled();
});

it('rejects ambiguous publication scopes', async () => {
  for (const local of [true, 'true']) {
    expect((await post({ action: 'publish', local, worker: 'one', name: 'check' })).status).toBe(400);
  }
  expect(openNacosSkills).not.toHaveBeenCalled();
});

it('reports the last publication, the version ARD serves and the native latest independently', async () => {
  const source = 'registry/team/check';
  const nacos = { meta: async () => ({ labels: { latest: '1.2.0' }, versions: [{ version: '1.0.0', status: 'online' }] }),
    find: async () => ({ version: '1.1.0' }), item: () => ({ source }) };
  vi.mocked(openNacosSkills).mockResolvedValueOnce(nacos as unknown as Awaited<ReturnType<typeof openNacosSkills>>);
  vi.mocked(publicationStore).mockResolvedValueOnce({ source, associate: vi.fn(), save: vi.fn(),
    record: { version: '1.0.0', base: '', source, message: 'First release', digest: 'hash' } });
  const res = await GET(new NextRequest('http://localhost/api/agentteams/skills/nacos/ard?receipt=1&local=1&name=check'));
  expect(res.status).toBe(200);
  expect((await res.json()).receipt).toMatchObject({ status: 'online', version: '1.0.0', upstream: '1.1.0', latest: '1.2.0', discovered: false });
});
