// @vitest-environment node
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import { GET } from './route';

const listObjects = vi.fn();

vi.mock('@/lib/minio-client', () => ({
  createMinioClient: () => ({ listObjects }),
  getMinioBucket: () => 'agentteams-data',
}));
vi.mock('@/lib/audit-log', () => ({ appendAuditEvent: vi.fn() }));

const teamAdminHeaders = {
  'x-agentteams-user': 'team-admin',
  'x-agentteams-user-level': '3',
  'x-agentteams-scope': 'scoped',
  'x-agentteams-teams': JSON.stringify(['sysdev']),
};

function streamOf(items: Array<Record<string, unknown>>) {
  return Readable.from(items);
}

describe('GET /api/agentteams/teams/[name]/files', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the team root non-recursively', async () => {
    listObjects.mockReturnValueOnce(
      streamOf([
        { prefix: 'teams/sysdev/shared/' },
        { name: 'teams/sysdev/readme.md', size: 12 },
      ]),
    );
    const req = new NextRequest('http://localhost/api/agentteams/teams/sysdev/files', {
      headers: teamAdminHeaders,
    });
    const res = await GET(req, { params: Promise.resolve({ name: 'sysdev' }) });
    expect(res.status).toBe(200);
    expect(listObjects).toHaveBeenCalledWith('agentteams-data', 'teams/sysdev', false);
    const body = await res.json();
    expect(body.root).toBe('teams/sysdev/');
    expect(body.objects).toEqual([
      { key: 'teams/sysdev/shared/', size: 0, isPrefix: true },
      { key: 'teams/sysdev/readme.md', size: 12 },
    ]);
  });

  it('accepts a full-key prefix and lists the subtree', async () => {
    listObjects.mockReturnValueOnce(
      streamOf([{ prefix: 'teams/sysdev/shared/tasks/' }]),
    );
    const req = new NextRequest(
      'http://localhost/api/agentteams/teams/sysdev/files?prefix=teams%2Fsysdev%2Fshared%2F',
      { headers: teamAdminHeaders },
    );
    const res = await GET(req, { params: Promise.resolve({ name: 'sysdev' }) });
    expect(res.status).toBe(200);
    expect(listObjects).toHaveBeenCalledWith('agentteams-data', 'teams/sysdev/shared', false);
    const body = await res.json();
    expect(body.objects[0].key).toBe('teams/sysdev/shared/tasks/');
  });

  it('rejects invalid team names', async () => {
    const req = new NextRequest('http://localhost/api/agentteams/teams/bad%2Fname/files');
    const res = await GET(req, { params: Promise.resolve({ name: 'bad/name' }) });
    expect(res.status).toBe(400);
  });

  it.each<[string, Record<string, string>, number]>([
    ['missing identity', {}, 401],
    ['unknown scope', {
      'x-agentteams-user': 'user',
      'x-agentteams-user-level': '1',
      'x-agentteams-scope': 'unknown',
    }, 403],
    ['cross-resource scope', {
      ...teamAdminHeaders,
      'x-agentteams-teams': JSON.stringify(['other']),
    }, 403],
  ])('denies %s before storage access', async (_label, headers, status) => {
    const req = new NextRequest('http://localhost/api/agentteams/teams/sysdev/files', { headers });
    const res = await GET(req, { params: Promise.resolve({ name: 'sysdev' }) });
    expect(res.status).toBe(status);
    expect(listObjects).not.toHaveBeenCalled();
  });
});
