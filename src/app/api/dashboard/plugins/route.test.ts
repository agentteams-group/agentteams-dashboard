// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const fsMock = vi.hoisted(() => ({
  readdir: vi.fn(),
  access: vi.fn(),
}));

vi.mock('node:fs/promises', () => fsMock);

import { GET } from './route';

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
