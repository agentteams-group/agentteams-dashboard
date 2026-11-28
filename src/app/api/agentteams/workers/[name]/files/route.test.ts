import { EventEmitter } from 'node:events';
import { NextRequest } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const { listObjects } = vi.hoisted(() => ({ listObjects: vi.fn() }));

vi.mock('@/lib/minio-client', () => ({
  createMinioClient: () => ({ listObjects }),
  getMinioBucket: () => 'agentteams-storage',
}));
vi.mock('@/lib/audit-log', () => ({ appendAuditEvent: vi.fn() }));

function workerHeaders(name: string) {
  return {
    'x-agentteams-user': 'worker-admin',
    'x-agentteams-user-level': '3',
    'x-agentteams-scope': 'scoped',
    'x-agentteams-workers': JSON.stringify([name]),
  };
}

function createObjectStream(objects: Record<string, unknown>[]) {
  const stream = new EventEmitter();
  // setImmediate (not queueMicrotask): the handler only registers 'data'/'end'
  // listeners after its `await params` continuation, which runs after the
  // microtask queue. setImmediate fires after all microtasks, so the mock
  // stream's events are always observed by the handler.
  setImmediate(() => {
    objects.forEach((object) => stream.emit('data', object));
    stream.emit('end');
  });
  return stream;
}

describe('GET /api/agentteams/workers/[name]/files', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads a Worker root directory from the configured bucket', async () => {
    listObjects.mockReturnValue(createObjectStream([
      { name: 'manager/AGENTS.md', size: 120 },
      { prefix: 'manager/logs/' },
    ]));

    const response = await GET(new NextRequest('http://localhost', { headers: workerHeaders('manager') }), {
      params: Promise.resolve({ name: 'manager' }),
    });

    expect(response.status).toBe(200);
    expect(listObjects).toHaveBeenCalledWith('agentteams-storage', 'manager/', false);
    await expect(response.json()).resolves.toEqual({
      objects: [
        { key: 'manager/AGENTS.md', size: 120 },
        { key: 'manager/logs/', size: 0, isPrefix: true },
      ],
      prefix: '',
    });
  });

  it('falls back to the agents prefix for Worker files', async () => {
    listObjects
      .mockReturnValueOnce(createObjectStream([]))
      .mockReturnValueOnce(createObjectStream([{ name: 'agents/ce1/AGENTS.md', size: 120 }]));

    const response = await GET(new NextRequest('http://localhost', { headers: workerHeaders('ce1') }), {
      params: Promise.resolve({ name: 'ce1' }),
    });

    expect(response.status).toBe(200);
    expect(listObjects).toHaveBeenLastCalledWith('agentteams-storage', 'agents/ce1/', false);
    await expect(response.json()).resolves.toEqual({
      objects: [{ key: 'ce1/AGENTS.md', size: 120 }],
      prefix: '',
    });
  });

  it('rejects an unsafe Worker name', async () => {
    const response = await GET(new NextRequest('http://localhost'), {
      params: Promise.resolve({ name: '../manager' }),
    });

    expect(response.status).toBe(400);
  });

  it.each<[string, Record<string, string>, number]>([
    ['missing identity', {}, 401],
    ['unknown scope', {
      'x-agentteams-user': 'user',
      'x-agentteams-user-level': '1',
      'x-agentteams-scope': 'unknown',
    }, 403],
    ['cross-resource scope', {
      ...workerHeaders('manager'),
      'x-agentteams-workers': JSON.stringify(['other']),
    }, 403],
  ])('denies %s before storage access', async (_label, headers, status) => {
    const response = await GET(new NextRequest('http://localhost', { headers }), {
      params: Promise.resolve({ name: 'manager' }),
    });
    expect(response.status).toBe(status);
    expect(listObjects).not.toHaveBeenCalled();
  });

  it('B1：敏感文件（credentials.yaml / credentials/ 目录 / .ssh）不进入列表', async () => {
    listObjects.mockReturnValue(createObjectStream([
      { name: 'w1/MEMORY.md', size: 120 },
      { name: 'w1/credentials.yaml', size: 4547 },
      { prefix: 'w1/credentials/' },
      { name: 'w1/.ssh/id_rsa', size: 2600 },
      { prefix: 'w1/memory/' },
    ]));

    const response = await GET(new NextRequest('http://localhost', { headers: workerHeaders('w1') }), {
      params: Promise.resolve({ name: 'w1' }),
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    const keys = body.objects.map((o: { key: string }) => o.key);
    expect(keys).toContain('w1/MEMORY.md');
    expect(keys).toContain('w1/memory/');
    expect(keys).not.toContain('w1/credentials.yaml');
    expect(keys).not.toContain('w1/credentials/');
    expect(keys).not.toContain('w1/.ssh/id_rsa');
  });
});
