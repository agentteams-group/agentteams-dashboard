import { afterEach, describe, it, expect, vi } from 'vitest';
import { appendWorkerSkill, normalizeKubeMode, agentteamsApi, saveHumanModelAccess, saveHumanWorkspaceAccess } from '@/lib/agentteams-api';

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

describe('Human configuration concurrent sibling writes', () => {
  const modelAccess = { scopes: [{ provider: 'provider-a', models: ['model-a'] }] };
  const workspaceAccess = {
    grants: [{ team: 'team-a', paths: ['files/docs'], mode: 'read' as const }],
  };

  function json(body: unknown, status = 200, etag?: string) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...(etag ? { etag } : {}) },
    });
  }

  it('preserves sibling fields when model and workspace PATCHes run concurrently', async () => {
    const record = {
      metadata: { name: 'alice' },
      spec: { modelAccess: { scopes: [] }, workspaceAccess: {}, untouched: 'keep' },
    };
    const patches: Array<Record<string, unknown>> = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return json(record, 200, 'human-v1');
      if (method === 'PATCH') {
        const patch = JSON.parse(String(init?.body)) as { spec: Record<string, unknown> };
        patches.push(patch.spec);
        Object.assign(record.spec, patch.spec);
        return json(record, 200, 'human-v2');
      }
      throw new Error(`unexpected ${method}`);
    }) as unknown as typeof fetch;

    const results = await Promise.all([
      saveHumanModelAccess('alice', modelAccess),
      saveHumanWorkspaceAccess('alice', workspaceAccess),
    ]);

    expect(results.map((result) => result.method)).toEqual(['PATCH', 'PATCH']);
    expect(patches).toHaveLength(2);
    expect(record.spec).toMatchObject({ modelAccess, workspaceAccess, untouched: 'keep' });
    expect(results[1]).toMatchObject({ verified: true });
  });

  it('retries a sibling write with If-Match after a concurrent fallback PUT', async () => {
    const record = {
      metadata: { name: 'alice' },
      spec: { modelAccess: { scopes: [] }, workspaceAccess: {}, untouched: 'keep' },
    };
    let version = 0;
    const conditionalWrites: string[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      const method = init?.method ?? 'GET';
      if (method === 'PATCH') return json({ error: 'method not allowed' }, 405);
      if (method === 'GET') return json(record, 200, `human-v${version}`);
      if (method === 'PUT') {
        const ifMatch = new Headers(init?.headers).get('If-Match');
        conditionalWrites.push(ifMatch ?? '');
        if (ifMatch !== `human-v${version}`) return json({ error: 'conflict' }, 409);
        const body = JSON.parse(String(init?.body)) as typeof record;
        Object.assign(record.spec, body.spec);
        version += 1;
        return json(record, 200, `human-v${version}`);
      }
      throw new Error(`unexpected ${method}`);
    }) as unknown as typeof fetch;

    await Promise.all([
      saveHumanModelAccess('alice', modelAccess),
      saveHumanWorkspaceAccess('alice', workspaceAccess),
    ]);

    expect(conditionalWrites).toHaveLength(3);
    expect(conditionalWrites[0]).toBe('human-v0');
    expect(conditionalWrites[1]).toBe('human-v0');
    expect(conditionalWrites[2]).toBe('human-v1');
    expect(record.spec).toMatchObject({ modelAccess, workspaceAccess, untouched: 'keep' });
  });

  it('refuses a blind fallback PUT when the controller provides no ETag', async () => {
    const fetchMock = vi.fn(async (_url, init) => {
      if ((init?.method ?? 'GET') === 'PATCH') return json({ error: 'unsupported' }, 405);
      return json({ spec: {} });
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(saveHumanModelAccess('alice', modelAccess)).rejects.toMatchObject({ status: 409 });
    expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'PUT')).toBe(false);
  });
});

describe('Worker skill concurrent appends', () => {
  function json(body: unknown, status = 200, etag?: string) {
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json', ...(etag ? { etag } : {}) },
    });
  }

  it('uses the atomic append endpoint without a read-modify-write', async () => {
    const fetchMock = vi.fn(async () => json({ name: 'worker', skills: ['skill-a'] }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await appendWorkerSkill('worker', 'skill-a');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(String(url)).toContain('/api/agentteams/workers/worker/skills/append');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ skillName: 'skill-a' });
  });

  it('retains both A and B skills when fallback PUTs race with stale ETags', async () => {
    let version = 0;
    let skills: string[] = [];
    const conditionalWrites: string[] = [];
    globalThis.fetch = vi.fn(async (_url, init) => {
      const method = init?.method ?? 'GET';
      const path = String(_url);
      if (method === 'POST' && path.includes('/skills/append')) return json({ error: 'unsupported' }, 405);
      if (method === 'GET') return json({ name: 'worker', skills }, 200, `worker-v${version}`);
      if (method === 'PUT') {
        const ifMatch = new Headers(init?.headers).get('If-Match');
        conditionalWrites.push(ifMatch ?? '');
        if (ifMatch !== `worker-v${version}`) return json({ error: 'conflict' }, 409);
        const body = JSON.parse(String(init?.body)) as { skills: string[] };
        skills = body.skills;
        version += 1;
        return json({ name: 'worker', skills }, 200, `worker-v${version}`);
      }
      throw new Error(`unexpected ${method} ${path}`);
    }) as unknown as typeof fetch;

    await Promise.all([
      appendWorkerSkill('worker', 'skill-a'),
      appendWorkerSkill('worker', 'skill-b'),
    ]);

    expect(skills).toEqual(['skill-a', 'skill-b']);
    expect(conditionalWrites).toHaveLength(3);
    expect(conditionalWrites.filter((etag) => etag === 'worker-v0')).toHaveLength(2);
    expect(conditionalWrites).toContain('worker-v1');
  });
});

describe('agentteamsApi.getTeamAttention', () => {
  const payload = {
    team_id: 'biz-team',
    items: [],
    count: 0,
    truncated: false,
  };

  function mockFetch() {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(payload), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }));
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    return fetchMock;
  }

  it('GETs the team attention proxy route with encoded name', async () => {
    const fetchMock = mockFetch();
    const res = await agentteamsApi.getTeamAttention('biz team');

    expect(res.team_id).toBe('biz-team');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [unknown, RequestInit];
    expect(String(url)).toContain('/api/agentteams/teams/biz%20team/attention');
    expect((init as RequestInit).method ?? 'GET').toBe('GET');
  });

  it('omits the query string when no filter is given', async () => {
    const fetchMock = mockFetch();
    await agentteamsApi.getTeamAttention('biz-team');
    const [url] = fetchMock.mock.calls[0] as unknown as [unknown];
    expect(String(url)).toContain('/teams/biz-team/attention/');
    expect(String(url)).not.toContain('?');
  });

  it('forwards status and limit', async () => {
    const fetchMock = mockFetch();
    await agentteamsApi.getTeamAttention('biz-team', { status: 'overdue', limit: 25 });
    const [url] = fetchMock.mock.calls[0] as unknown as [unknown];
    expect(String(url)).toContain('status=overdue');
    expect(String(url)).toContain('limit=25');
  });

  it('surfaces a 404 so callers can render the upgrade placeholder', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{"message":"team not found"}', {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    })) as unknown as typeof fetch;

    await expect(agentteamsApi.getTeamAttention('ghost')).rejects.toMatchObject({ status: 404 });
  });
});
