import { afterEach, describe, it, expect, vi } from 'vitest';
import { normalizeKubeMode, agentteamsApi } from '@/lib/agentteams-api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('normalizeKubeMode', () => {
  it('passes booleans through', () => {
    expect(normalizeKubeMode(true)).toBe(true);
    expect(normalizeKubeMode(false)).toBe(false);
  });

  it('treats v1.2.0 string values correctly', () => {
    expect(normalizeKubeMode('incluster')).toBe(true);
    expect(normalizeKubeMode('k8s')).toBe(true);
    expect(normalizeKubeMode('embedded')).toBe(false);
  });

  it('treats unknown or missing values as not k8s', () => {
    expect(normalizeKubeMode(undefined)).toBe(false);
    expect(normalizeKubeMode(null)).toBe(false);
    expect(normalizeKubeMode('')).toBe(false);
    expect(normalizeKubeMode('something-else')).toBe(false);
  });
});

describe('agentteamsApi.deleteTeam', () => {
  it('actually issues a DELETE to the agentteams proxy route', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await agentteamsApi.deleteTeam('alpha-team');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(String(url)).toContain('/api/agentteams/teams/alpha-team');
    expect((init as RequestInit).method).toBe('DELETE');
  });

  it('throws ApiError on non-2xx instead of swallowing the error', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"error":"forbidden"}', {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;

    await expect(agentteamsApi.deleteTeam('alpha-team')).rejects.toMatchObject({ status: 403 });
  });

  it('throws ApiError when the proxy returns a 200 non-JSON body', async () => {
    globalThis.fetch = vi.fn(async () => new Response('plain text', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })) as unknown as typeof fetch;

    await expect(agentteamsApi.deleteTeam('alpha-team')).rejects.toThrow(/non-JSON/);
  });

  it('resolves on 204 No Content', async () => {
    globalThis.fetch = vi.fn(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;

    await expect(agentteamsApi.deleteTeam('alpha-team')).resolves.toBeUndefined();
  });
});
