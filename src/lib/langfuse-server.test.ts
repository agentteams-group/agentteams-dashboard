import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { getTrace, listTraces } from './langfuse-server';

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
    await listTraces(new URLSearchParams('worker=alice&runtime=hermes&task=task-a&page=2&baseUrl=https://evil.example'));
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
    await expect(getTrace('../projects')).rejects.toMatchObject({ status: 400 });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('does not relay an upstream secret-bearing error body', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('sk-private', { status: 401 })));
    await expect(listTraces(new URLSearchParams())).rejects.toThrow('Langfuse 查询失败（401）');
  });

  it('reports missing configuration', async () => {
    vi.stubEnv('LANGFUSE_SECRET_KEY', '');
    await expect(listTraces(new URLSearchParams())).rejects.toMatchObject({ status: 503 });
  });

  it('queries a complete session without silently restricting its age', async () => {
    const fetcher = vi.fn().mockResolvedValue(Response.json({ data: [], meta: { page: 1 } }));
    vi.stubGlobal('fetch', fetcher);
    await listTraces(new URLSearchParams('session=worker%3Asession&team=t&room=r&project=p'));
    const url = new URL(fetcher.mock.calls[0][0]);
    expect(url.searchParams.get('sessionId')).toBe('worker:session');
    expect(url.searchParams.has('fromTimestamp')).toBe(false);
    expect(url.searchParams.getAll('tags')).toEqual(expect.arrayContaining(['team:t', 'room:r', 'project:p']));
  });
});
