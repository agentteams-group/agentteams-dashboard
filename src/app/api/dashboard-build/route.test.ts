import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getServerBuildId: vi.fn<() => string>(),
  getServerBuiltAt: vi.fn<() => string | undefined>(),
}));

vi.mock('@/lib/build-id', () => ({
  getServerBuildId: mocks.getServerBuildId,
  getServerBuiltAt: mocks.getServerBuiltAt,
}));

import { GET } from './route';

describe('GET /api/dashboard-build', () => {
  beforeEach(() => {
    mocks.getServerBuildId.mockReturnValue('abc123def456');
    mocks.getServerBuiltAt.mockReturnValue('2026-09-29T08:03:00Z');
  });

  it('returns the process build identity', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      buildId: 'abc123def456',
      builtAt: '2026-09-29T08:03:00Z',
    });
  });

  it('is stable across calls within the same process', async () => {
    const first = await (await GET()).json();
    const second = await (await GET()).json();
    expect(second).toEqual(first);
  });

  it('degrades to unknown with null builtAt when the build file is unreadable', async () => {
    mocks.getServerBuildId.mockReturnValue('unknown');
    mocks.getServerBuiltAt.mockReturnValue(undefined);
    const res = await GET();
    expect(await res.json()).toEqual({ buildId: 'unknown', builtAt: null });
  });
});
