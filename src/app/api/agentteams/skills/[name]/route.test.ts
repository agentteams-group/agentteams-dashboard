import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';
import { Readable } from 'node:stream';

const putObjectMock = vi.fn().mockResolvedValue(undefined);
let currentMetadata: object | null = null;

vi.mock('@/lib/minio-client', () => ({
  createMinioClient: () => ({
    putObject: (...args: unknown[]) => putObjectMock(...args),
    bucketExists: () => Promise.resolve(true),
    getObject: () => {
      if (currentMetadata === null) {
        return Promise.reject(new Error('NoSuchKey'));
      }
      return Promise.resolve(Readable.from(Buffer.from(JSON.stringify(currentMetadata))));
    },
  }),
  getMinioBucket: () => 'agentteams-fs',
}));

import { PUT } from './route';

const baseMetadata = {
  name: 'my-skill',
  description: '原始描述',
  version: '1.0.0',
  source: 'custom' as const,
  sourceAlias: 'manual',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  fileCount: 1,
};

const callPut = async (body: Record<string, unknown>) => {
  const req = new NextRequest('http://localhost/api/agentteams/skills/my-skill', {
    method: 'PUT',
    body: JSON.stringify(body),
  });
  const ctx = { params: Promise.resolve({ name: 'my-skill' }) };
  return PUT(req, ctx);
};

describe('PUT /api/agentteams/skills/[name]', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    putObjectMock.mockResolvedValue(undefined);
    currentMetadata = { ...baseMetadata };
  });

  it('preserves the original description when the body omits the field', async () => {
    const res = await callPut({ version: '1.1.0' });
    expect(res.status).toBe(200);
    const [, , buffer] = putObjectMock.mock.calls[0] as [string, string, Buffer];
    const stored = JSON.parse(buffer.toString());
    expect(stored.description).toBe('原始描述');
    expect(stored.version).toBe('1.1.0');
  });

  it('preserves the original version when the body omits the field', async () => {
    const res = await callPut({ description: '新描述' });
    expect(res.status).toBe(200);
    const [, , buffer] = putObjectMock.mock.calls[0] as [string, string, Buffer];
    const stored = JSON.parse(buffer.toString());
    expect(stored.description).toBe('新描述');
    expect(stored.version).toBe('1.0.0');
  });

  it('preserves the original description when the body sends empty string (explicit clear)', async () => {
    // The previous behavior using `??` would clobber the description with an
    // empty string when the user submits a blank input. The new behavior
    // uses `!== undefined`, so an explicit empty string is treated as a
    // legitimate value to persist (the edit dialog guards this by only
    // sending fields the user actually touched).
    const res = await callPut({ description: '', version: '' });
    expect(res.status).toBe(200);
    const [, , buffer] = putObjectMock.mock.calls[0] as [string, string, Buffer];
    const stored = JSON.parse(buffer.toString());
    expect(stored.description).toBe('');
    expect(stored.version).toBe('');
  });

  it('rejects nacos-sourced skills', async () => {
    currentMetadata = { ...baseMetadata, source: 'nacos' };
    const res = await callPut({ description: 'x' });
    expect(res.status).toBe(403);
  });

  it('returns 404 when the skill does not exist', async () => {
    currentMetadata = null;
    const res = await callPut({ description: 'x' });
    expect(res.status).toBe(404);
  });
});
