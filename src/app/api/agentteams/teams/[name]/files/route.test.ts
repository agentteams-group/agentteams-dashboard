// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { Readable } from 'node:stream';
import { GET } from './route';

const listObjects = vi.fn();

vi.mock('@/lib/minio-client', () => ({
  createMinioClient: () => ({ listObjects }),
  getMinioBucket: () => 'agentteams-data',
}));

function streamOf(items: Array<Record<string, unknown>>) {
  return Readable.from(items);
}

describe('GET /api/agentteams/teams/[name]/files', () => {
  it('lists the team root non-recursively', async () => {
    listObjects.mockReturnValueOnce(
      streamOf([
        { prefix: 'teams/sysdev/shared/' },
        { name: 'teams/sysdev/readme.md', size: 12 },
      ]),
    );
    const req = new NextRequest('http://localhost/api/agentteams/teams/sysdev/files');
    const res = await GET(req, { params: Promise.resolve({ name: 'sysdev' }) });
    expect(res.status).toBe(200);
    expect(listObjects).toHaveBeenCalledWith('agentteams-data', 'teams/sysdev/', false);
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
    );
    const res = await GET(req, { params: Promise.resolve({ name: 'sysdev' }) });
    expect(res.status).toBe(200);
    expect(listObjects).toHaveBeenCalledWith('agentteams-data', 'teams/sysdev/shared/', false);
    const body = await res.json();
    expect(body.objects[0].key).toBe('teams/sysdev/shared/tasks/');
  });

  it('rejects invalid team names', async () => {
    const req = new NextRequest('http://localhost/api/agentteams/teams/bad%2Fname/files');
    const res = await GET(req, { params: Promise.resolve({ name: 'bad/name' }) });
    expect(res.status).toBe(400);
  });
});
