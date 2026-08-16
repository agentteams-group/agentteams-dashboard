// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  readdir: vi.fn(),
  access: vi.fn(),
}));

vi.mock('node:fs/promises', () => fsMock);

const packageMock = vi.hoisted(() => ({
  installPluginPackage: vi.fn(),
  MAX_ZIP_BYTES: 5 * 1024 * 1024,
}));

vi.mock('@/lib/plugins/server-package', () => packageMock);

const authMock = vi.hoisted(() => ({ validateHigressSession: vi.fn() }));

vi.mock('@/lib/api-auth', () => authMock);

import { NextRequest } from 'next/server';
import { GET, POST } from './route';
import { PluginManifestError } from '@/lib/plugins/manifest';

function postRequest(init?: ConstructorParameters<typeof NextRequest>[1]) {
  return new NextRequest('http://x/api/dashboard/plugins', { method: 'POST', ...init });
}

describe('GET /api/dashboard/plugins', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns an empty list when public/plugins is missing', async () => {
    fsMock.readdir.mockRejectedValue(new Error('ENOENT'));
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ plugins: [] });
  });

  it('discovers directories that contain a plugin.json', async () => {
    fsMock.readdir.mockResolvedValue([
      { name: 'alpha', isDirectory: () => true },
      { name: 'not-a-dir', isDirectory: () => false },
      { name: 'beta', isDirectory: () => true },
    ]);
    // alpha has a manifest, beta does not.
    fsMock.access.mockImplementation(async (p: string) => {
      if (p.includes('alpha')) return;
      throw new Error('ENOENT');
    });

    const res = await GET();
    const body = await res.json();
    expect(body.plugins).toHaveLength(1);
    expect(body.plugins[0].id).toBe('alpha');
    expect(body.plugins[0].manifestUrl).toContain('/plugins/alpha/plugin.json');
  });
});

describe('POST /api/dashboard/plugins', () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it('rejects unauthenticated uploads with 401', async () => {
    authMock.validateHigressSession.mockResolvedValue(false);
    const res = await POST(postRequest());
    expect(res.status).toBe(401);
    expect(packageMock.installPluginPackage).not.toHaveBeenCalled();
  });

  it('rejects non-multipart requests', async () => {
    authMock.validateHigressSession.mockResolvedValue(true);
    const res = await POST(postRequest());
    expect(res.status).toBe(415);
  });

  it('installs a valid zip package and returns the manifest URL', async () => {
    authMock.validateHigressSession.mockResolvedValue(true);
    packageMock.installPluginPackage.mockResolvedValue({
      id: 'alpha',
      manifestUrl: '/plugins/alpha/plugin.json',
    });
    const form = new FormData();
    form.append('file', new File(['zip-bytes'], 'alpha.zip', { type: 'application/zip' }));
    const res = await POST(postRequest({ body: form }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.manifestUrl).toBe('/plugins/alpha/plugin.json');
  });

  it('maps manifest validation errors to a 400 with a readable message', async () => {
    authMock.validateHigressSession.mockResolvedValue(true);
    packageMock.installPluginPackage.mockRejectedValue(new PluginManifestError('未找到 plugin.json'));
    const form = new FormData();
    form.append('file', new File(['zip-bytes'], 'bad.zip', { type: 'application/zip' }));
    const res = await POST(postRequest({ body: form }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('未找到 plugin.json');
  });

  it('rejects an empty file', async () => {
    authMock.validateHigressSession.mockResolvedValue(true);
    const form = new FormData();
    form.append('file', new File([], 'empty.zip', { type: 'application/zip' }));
    const res = await POST(postRequest({ body: form }));
    expect(res.status).toBe(400);
  });
});
