import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import { GET } from './route';

const { listObjects } = vi.hoisted(() => ({ listObjects: vi.fn() }));

vi.mock('@/lib/minio-client', () => ({
  createMinioClient: () => ({ listObjects }),
  getMinioBucket: () => 'agentteams-storage',
}));

function createObjectStream(objects: Record<string, unknown>[]) {
  const stream = new EventEmitter();
  queueMicrotask(() => {
    objects.forEach((object) => stream.emit('data', object));
    stream.emit('end');
  });
  return stream;
}

describe('GET /api/agentteams/workers/[name]/files', () => {
  it('reads a Worker root directory from the configured bucket', async () => {
    listObjects.mockReturnValue(createObjectStream([
      { name: 'manager/AGENTS.md', size: 120 },
      { prefix: 'manager/logs/' },
    ]));

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ name: 'manager' }),
    });

    expect(response.status).toBe(200);
    expect(listObjects).toHaveBeenCalledWith('agentteams-storage', 'manager/', false);
    await expect(response.json()).resolves.toEqual({
      objects: [
        { key: 'manager/AGENTS.md', size: 120 },
        { key: 'manager/logs/', size: 0, isPrefix: true },
      ],
    });
  });

  it('falls back to the agents prefix for Worker files', async () => {
    listObjects
      .mockReturnValueOnce(createObjectStream([]))
      .mockReturnValueOnce(createObjectStream([{ name: 'agents/ce1/AGENTS.md', size: 120 }]));

    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ name: 'ce1' }),
    });

    expect(response.status).toBe(200);
    expect(listObjects).toHaveBeenLastCalledWith('agentteams-storage', 'agents/ce1/', false);
    await expect(response.json()).resolves.toEqual({
      objects: [{ key: 'agents/ce1/AGENTS.md', size: 120 }],
    });
  });

  it('rejects an unsafe Worker name', async () => {
    const response = await GET(new Request('http://localhost'), {
      params: Promise.resolve({ name: '../manager' }),
    });

    expect(response.status).toBe(400);
  });
});
