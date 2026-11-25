import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const { statObject, enforceLevelOnlyRbac } = vi.hoisted(() => ({
  statObject: vi.fn(),
  enforceLevelOnlyRbac: vi.fn(async () => null),
}));

vi.mock('@/lib/minio-client', () => ({ createMinioClient: () => ({ statObject }) }));
vi.mock('@/lib/server-auth', () => ({ enforceLevelOnlyRbac }));

import { GET } from './route';

function request(key: string) {
  return new NextRequest(`http://localhost/api/agentteams/storage/download?bucket=test&key=${encodeURIComponent(key)}`);
}

describe('storage download denials and failures', () => {
  beforeEach(() => vi.clearAllMocks());

  it.each(['workers/demo/worker.token', 'workers/demo/service-account.token'])('rejects %s before contacting storage', async (key) => {
    const response = await GET(request(key));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: '文件不存在' });
    expect(statObject).not.toHaveBeenCalled();
  });

  it.each(['NoSuchKey', 'NotFound'])('maps the S3 %s code to 404', async (code) => {
    statObject.mockRejectedValueOnce(Object.assign(new Error('Not Found'), { code }));
    const response = await GET(request('report.txt'));
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: '文件不存在' });
  });

  it('keeps storage outages distinct from missing objects', async () => {
    statObject.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    expect((await GET(request('report.txt'))).status).toBe(502);
  });
});
