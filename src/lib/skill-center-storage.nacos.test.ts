// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import { syncNacosSkills } from './skill-center-storage';

const { token } = vi.hoisted(() => ({ token: 'storage secret/+?&=xyz' }));
vi.mock('./nacos-fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./nacos-fetcher')>();
  return { ...actual, getNacosAccessToken: vi.fn().mockResolvedValue(token) };
});
vi.mock('./minio-client', () => ({ createMinioClient: vi.fn(), getMinioBucket: vi.fn() }));

const config = {
  registryUrl: 'nacos://nacos.example.com:8848/public',
  protocol: 'https' as const,
  mode: 'services' as const,
  namespace: 'public',
  username: 'u',
  password: 'p',
};

afterEach(() => vi.unstubAllGlobals());

describe('syncNacosSkills credential hygiene (SEC-04)', () => {
  it('keeps tokens out of persisted diagnostics on HTTP 500', async () => {
    const encoded = encodeURIComponent(token);
    const fetchMock = vi.fn().mockResolvedValue(new Response(`${token} ${encoded} ?accessToken=${encoded}`, { status: 500 }));
    vi.stubGlobal('fetch', fetchMock);
    const result = await syncNacosSkills(config);
    expect(result.updatedConfig.lastSyncStatus).toBe('error');
    expect(result.updatedConfig.lastSyncError).not.toContain(token);
    expect(result.updatedConfig.lastSyncError).not.toContain(encoded);
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).not.toContain('accessToken');
    expect(new Headers(init.headers).get('authorization')).toBe(`Bearer ${token}`);
  });

  it('keeps tokens out of persisted diagnostics on invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(token, { status: 200 })));
    const result = await syncNacosSkills(config);
    expect(result.updatedConfig.lastSyncStatus).toBe('error');
    expect(result.updatedConfig.lastSyncError).not.toContain(token);
    expect(result.updatedConfig.lastSyncError).not.toContain(encodeURIComponent(token));
  });
});
