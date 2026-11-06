import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { getTrace, listTraces, testAgentLoopConnection } from './agentloop-server';
import { readObservabilityConfig, saveObservabilityConfig } from './observability-config';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const credential = vi.hoisted(() => vi.fn().mockResolvedValue({ accessKeyId: 'test-id', accessKeySecret: 'test-secret', securityToken: 'test-sts' }));
vi.mock('@alicloud/credentials', () => ({ default: class { getCredential = credential; } }));
const scope = { teams: [{ name: 't', label: 'T' }], workers: [{ name: 'alice', team: 't' }] };
const id = 'a'.repeat(32);
let directory: string;
function row(spanId = '1'.repeat(16), kind = 'ENTRY', worker = 'alice', team = 't') {
  return { traceId: id, spanId, parentSpanId: kind === 'ENTRY' ? '' : '1'.repeat(16), operationName: kind === 'LLM' ? 'chat demo' : 'worker.turn',
    startTime: '1793960000000000000', duration: '1500000000', statusCode: 'OK', attributes: JSON.stringify({
      'gen_ai.span.kind': kind, 'gen_ai.session.id': 'alice:session', 'agentteams.worker.name': worker, 'agentteams.team.id': team,
      'agentteams.runtime': 'hermes', 'agentteams.turn.id': 'turn', 'gen_ai.request.model': 'demo',
      'gen_ai.usage.input_tokens': 120, 'gen_ai.usage.output_tokens': 30,
      'gen_ai.input.messages': '[{"role":"user","parts":[{"type":"text","content":"hello"}]}]',
    }) };
}
function response(rows: unknown[], progress = 'Complete') { return Response.json(rows, { headers: { 'x-log-progress': progress } }); }
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'at-agentloop-'));
  vi.stubEnv('DASHBOARD_CONFIG_FILE', path.join(directory, 'config.json'));
  vi.stubEnv('AGENTLOOP_SLS_ENDPOINT', 'http://127.0.0.1:19098');
  await saveObservabilityConfig({ ...await readObservabilityConfig(), backend: 'agentloop',
    agentloop: { region: 'cn-hangzhou', workspace: 'ws-demo', project: 'trace-project', logstore: 'trace-store' } });
});
afterEach(async () => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); await fs.rm(directory, { recursive: true, force: true }); });

it('signs HTTPS/STS queries server-side, reads all root pages and filters scope before counts', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(response([row(), row('2'.repeat(16), 'ENTRY', 'secret'), row('3'.repeat(16), 'ENTRY', 'alice', 'old')])).mockResolvedValueOnce(response([]));
  vi.stubGlobal('fetch', fetcher);
  const result = await listTraces(new URLSearchParams('worker=alice'), scope);
  expect(result.meta.totalItems).toBe(1);
  expect(result.data[0]).toMatchObject({ id, sessionId: 'alice:session', latency: 1.5 });
  expect(result.data[0]).not.toHaveProperty('input');
  expect(JSON.stringify(result)).not.toContain('hello');
  const [url, options] = fetcher.mock.calls[0];
  expect(new URL(url).searchParams.get('query')).toContain('attributes.agentteams.worker.name:"alice"');
  expect(new URL(url).pathname).toBe('/logstores/trace-store');
  expect(options.headers.authorization).toMatch(/^LOG test-id:/);
  expect(options.headers['x-acs-security-token']).toBe('test-sts');
  expect(options.redirect).toBe('error');
  expect(new URL(fetcher.mock.calls[1][0]).searchParams.get('offset')).toBe('3');
});

it('reads every span page and preserves parent links, ns timing, messages and actual usage', async () => {
  const children = Array.from({ length: 101 }, (_, n) => row((n + 2).toString(16).padStart(16, '0'), 'LLM'));
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response([row(), ...children.slice(0, 99)])).mockResolvedValueOnce(response(children.slice(99))).mockResolvedValueOnce(response([])));
  const trace = await getTrace(id, scope);
  expect(trace.observations).toHaveLength(102);
  expect(trace.observations[1]).toMatchObject({ parentObservationId: '1'.repeat(16), type: 'GENERATION', usageDetails: { input: 120, output: 30 } });
  expect(trace.observations[1].input).toEqual([{ role: 'user', parts: [{ type: 'text', content: 'hello' }] }]);
  expect(Date.parse(trace.observations[0].endTime!) - Date.parse(trace.observations[0].startTime)).toBe(1500);
});

it('rejects foreign filters and empty scope before obtaining credentials', async () => {
  const fetcher = vi.fn(); vi.stubGlobal('fetch', fetcher);
  await expect(listTraces(new URLSearchParams('worker=secret'), scope)).rejects.toMatchObject({ status: 404 });
  await expect(getTrace('../secret', scope)).rejects.toMatchObject({ status: 400 });
  expect((await listTraces(new URLSearchParams(), { teams: [], workers: [] })).data).toEqual([]);
  expect(fetcher).not.toHaveBeenCalled(); expect(credential).not.toHaveBeenCalled();
});

it('does not return other workers or previous teams in direct trace access', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response([row('1'.repeat(16), 'ENTRY', 'alice', 'old')])).mockResolvedValueOnce(response([])));
  await expect(getTrace(id, scope)).rejects.toMatchObject({ status: 404 });
});

it('escapes session input, removes the time cutoff and excludes content from session lists', async () => {
  const fetcher = vi.fn().mockResolvedValue(response([])); vi.stubGlobal('fetch', fetcher);
  await listTraces(new URLSearchParams({ session: 's" OR * | SELECT secret' }), scope);
  const url = new URL(fetcher.mock.calls[0][0]);
  expect(url.searchParams.get('from')).toBe('0');
  expect(url.searchParams.get('query')).toContain('"s\\" OR * | SELECT secret"');
});

it('fails on incomplete or unknown query progress rather than returning a partial session', async () => {
  const fetcher = vi.fn().mockResolvedValue(response([row()], 'Incomplete')); vi.stubGlobal('fetch', fetcher);
  await expect(listTraces(new URLSearchParams(), scope)).rejects.toMatchObject({ status: 503 });
  expect(fetcher).toHaveBeenCalledTimes(3);
  fetcher.mockResolvedValue(Response.json([]));
  await expect(listTraces(new URLSearchParams(), scope)).rejects.toThrow('完整性');
});

it('does not expose upstream errors or credentials, and tests queries without fake trace writes', async () => {
  const fetcher = vi.fn().mockResolvedValue(new Response('test-secret', { status: 403 })); vi.stubGlobal('fetch', fetcher);
  await expect(listTraces(new URLSearchParams(), scope)).rejects.toThrow('AgentLoop 查询失败（HTTP 403）');
  fetcher.mockResolvedValue(response([]));
  expect(await testAgentLoopConnection(await readObservabilityConfig())).toMatchObject({ projectId: 'trace-project', source: 'dashboard' });
  expect(fetcher.mock.calls.every(([, options]) => !options.method || options.method === 'GET')).toBe(true);
});
