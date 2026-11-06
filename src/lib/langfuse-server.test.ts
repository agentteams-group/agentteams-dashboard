import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getTrace, listTraces, traceInScope } from './langfuse-server';
import type { TraceScope, TraceSummary } from './tracing-types';

const scope: TraceScope = { teams: [{ name: 't', label: 'T' }], workers: [{ name: 'alice', team: 't' }] };

beforeEach(() => {
  vi.stubEnv('LANGFUSE_BASE_URL', 'http://langfuse:3000');
  vi.stubEnv('LANGFUSE_PUBLIC_KEY', 'pk-demo');
  vi.stubEnv('LANGFUSE_SECRET_KEY', 'sk-private');
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('Langfuse query boundary', () => {
  it('uses server credentials and translates filters without accepting a browser URL', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [], meta: { page: 2 } }));
    vi.stubGlobal('fetch', fetcher);
    await listTraces(new URLSearchParams('worker=alice&runtime=hermes&task=task-a&page=2&baseUrl=https://evil.example'), scope);
    const [url, options] = fetcher.mock.calls[0];
    expect(url).toContain('http://langfuse:3000/api/public/traces?');
    expect(url).toContain('userId=alice');
    expect(url).toContain('tags=hermes');
    expect(url).toContain('tags=task%3Atask-a');
    expect(url).not.toContain('evil.example');
    expect(options.redirect).toBe('error');
    expect(options.headers.Authorization).toBe(`Basic ${Buffer.from('pk-demo:sk-private').toString('base64')}`);
  });

  it('rejects path traversal before fetching', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    await expect(getTrace('../projects', scope)).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not relay an upstream secret-bearing error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('sk-private', { status: 401 })));
    await expect(listTraces(new URLSearchParams(), scope)).rejects.toThrow('Langfuse 查询失败（401）');
  });

  it('reports missing configuration', async () => {
    vi.stubEnv('LANGFUSE_SECRET_KEY', '');
    await expect(listTraces(new URLSearchParams(), scope)).rejects.toMatchObject({ status: 503 });
  });

  it('queries a complete session without silently restricting its age', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [], meta: { page: 1 } }));
    vi.stubGlobal('fetch', fetcher);
    await listTraces(new URLSearchParams('session=worker%3Asession&team=t&room=r&project=p'), scope);
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get('sessionId')).toBe('worker:session');
    expect(url.searchParams.has('fromTimestamp')).toBe(false);
    expect(url.searchParams.getAll('tags')).toEqual(expect.arrayContaining(['team:t', 'room:r', 'project:p']));
  });

  it('rejects forged resource filters and never queries Langfuse for an empty scope', async () => {
    const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
    for (const query of ['worker=secret', 'team=secret']) {
      await expect(listTraces(new URLSearchParams(query), scope)).rejects.toMatchObject({ status: 404 });
    }
    expect(await listTraces(new URLSearchParams('session=secret'), { teams: [], workers: [] })).toMatchObject({
      data: [], meta: { totalItems: 0, totalPages: 0 },
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('filters all session pages before counts and excludes other accounts and previous teams', async () => {
    const summary = (id: string, userId: string, team: string) => ({ id, userId, tags: ['agentteams', 'worker-turn', `team:${team}`], metadata: {} });
    const fetcher = vi.fn().mockImplementation((url: string) => Promise.resolve(Response.json({
      data: url.includes('page=2') ? [summary('visible-2', 'alice', 't')] : [summary('visible-1', 'alice', 't'), summary('other-account', 'secret', 't'), summary('old-team', 'alice', 'old')],
      meta: { totalPages: 2, totalItems: 4 },
    })));
    vi.stubGlobal('fetch', fetcher);
    const result = await listTraces(new URLSearchParams('session=shared'), scope);
    expect(result.data.map((t) => t.id)).toEqual(['visible-1', 'visible-2']);
    expect(result.meta).toEqual({ page: 1, totalItems: 2, totalPages: 1 });
    const params = new URL(fetcher.mock.calls[0][0]).searchParams;
    expect(JSON.parse(params.get('filter')!)).toEqual([{ type: 'stringOptions', column: 'userId', operator: 'any of', value: ['alice'] }]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('denies direct access to another Worker trace before returning any observations', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ id: 'a'.repeat(32), userId: 'secret', tags: ['agentteams', 'worker-turn'], metadata: {}, observations: [{ input: 'secret prompt' }] })));
    await expect(getTrace('a'.repeat(32), scope)).rejects.toMatchObject({ status: 404 });
  });

  it('requires consistent Worker and Team attribution, including standalone workers', () => {
    const trace = { userId: 'alice', tags: ['agentteams', 'worker-turn', 'team:t'], metadata: {} } as TraceSummary;
    expect(traceInScope(trace, scope)).toBe(true);
    expect(traceInScope({ ...trace, metadata: { attributes: { 'agentteams.team.id': 'old' } } }, scope)).toBe(false);
    expect(traceInScope({ ...trace, metadata: { 'agentteams.worker.name': 'secret' } }, scope)).toBe(false);
    expect(traceInScope({ ...trace, tags: ['agentteams', 'worker-turn'] }, scope)).toBe(false);
    expect(traceInScope({ ...trace, tags: ['agentteams', 'worker-turn'] }, { teams: [], workers: [{ name: 'alice', team: '' }] })).toBe(true);
  });
});
