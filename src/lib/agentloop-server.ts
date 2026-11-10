// AgentLoop raw traces live in the CMS Workspace's XTrace SLS store, not its trajectory store.
import { createHmac } from 'node:crypto';
import Credential from '@alicloud/credentials';
import { observabilityUrl, validateAgentLoopConfig, type ObservabilityConfig } from './observability-config';
import { traceInScope } from './tracing-scope';
import { TracingError } from './tracing-error';
import type { TraceDetail, TraceList, TraceObservation, TraceScope, TraceSummary } from './tracing-types';

type Row = Record<string, unknown>;
let credential: Credential;

function json(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  try { return JSON.parse(value); } catch { return value; }
}

function attributes(row: Row): Row {
  const nested = json(row.attributes);
  return { ...(nested && typeof nested === 'object' && !Array.isArray(nested) ? nested : {}),
    ...Object.fromEntries(Object.entries(row).filter(([key]) => key.startsWith('attributes.')).map(([key, value]) => [key.slice(11), value])) };
}

function observation(row: Row): TraceObservation {
  const attrs = attributes(row);
  const start = Number(BigInt(String(row.startTime)) / BigInt(1000000));
  const duration = row.duration == null ? null : Number(BigInt(String(row.duration)) / BigInt(1000)) / 1000;
  if (!Number.isFinite(start) || (duration != null && duration < 0)) throw new TracingError(502, 'AgentLoop Trace 时间字段无效');
  const kind = String(attrs['gen_ai.span.kind'] ?? '');
  const operation = attrs['gen_ai.operation.name'];
  const type = kind === 'LLM' || operation === 'chat' ? 'GENERATION' : kind === 'TOOL' || operation === 'execute_tool' ? 'TOOL' : ['ENTRY', 'AGENT'].includes(kind) ? 'AGENT' : 'SPAN';
  const usage: Record<string, number> = {};
  for (const label of ['input', 'output'] as const) {
    const value = attrs[`gen_ai.usage.${label}_tokens`];
    if (value != null && Number.isFinite(Number(value)) && Number(value) >= 0) usage[label] = Number(value);
  }
  const error = ['ERROR', 'STATUS_CODE_ERROR', '2'].includes(String(row.statusCode).toUpperCase()) || attrs['agentteams.outcome'] === 'error';
  return { id: String(row.spanId), parentObservationId: row.parentSpanId && !/^0+$/.test(String(row.parentSpanId)) ? String(row.parentSpanId) : null,
    name: String(row.operationName ?? row.spanName ?? ''), type, startTime: new Date(start).toISOString(),
    endTime: duration == null ? null : new Date(start + duration).toISOString(), level: error ? 'ERROR' : 'DEFAULT',
    statusMessage: row.statusMessage == null ? null : String(row.statusMessage), model: attrs['gen_ai.request.model'] == null ? null : String(attrs['gen_ai.request.model']),
    usageDetails: usage, metadata: attrs,
    input: json(type === 'TOOL' ? attrs['gen_ai.tool.call.arguments'] : attrs['gen_ai.input.messages']),
    output: json(type === 'TOOL' ? attrs['gen_ai.tool.call.result'] : attrs['gen_ai.output.messages']) };
}

function summary(row: Row): TraceSummary {
  const attrs = attributes(row);
  const span = observation(row);
  const tags = attrs['agentteams.turn.id'] ? ['agentteams', 'worker-turn'] : [];
  if (attrs['agentteams.demo.fixture'] === true || attrs['agentteams.demo.fixture'] === 'true') tags.push('fixture');
  if (attrs['agentteams.runtime']) tags.push(String(attrs['agentteams.runtime']));
  for (const label of ['team', 'task', 'project', 'room']) if (attrs[`agentteams.${label}.id`]) tags.push(`${label}:${attrs[`agentteams.${label}.id`]}`);
  return { id: String(row.traceId), name: `${attrs['agentteams.worker.name']} / turn`, timestamp: span.startTime,
    userId: String(attrs['agentteams.worker.name'] ?? ''), sessionId: attrs['gen_ai.session.id'] == null ? null : String(attrs['gen_ai.session.id']),
    tags, metadata: Object.fromEntries(Object.entries(attrs).filter(([key]) => key.startsWith('agentteams.') || ['gen_ai.session.id', 'gen_ai.turn.id', 'gen_ai.span.kind'].includes(key))),
    latency: span.endTime ? (Date.parse(span.endTime) - Date.parse(span.startTime)) / 1000 : null };
}

function term(key: string, value: string) {
  if (value.length > 1024 || /[\r\n\0]/.test(value)) throw new TracingError(400, 'Trace 筛选值无效');
  return `${key}:${JSON.stringify(value)}`;
}

function workerQuery(scope: TraceScope) {
  return '(' + scope.workers.map((w) => term('attributes.agentteams.worker.name', w.name)).join(' OR ') + ')';
}

// SLS REST 0.6.0 signing follows the official Node SDK. Use fetch to retain
// x-log-progress, which that SDK discards, so partial results never look complete.
async function page(config: ObservabilityConfig, query: string, from: number, to: number, offset: number, line = 100): Promise<Row[]> {
  validateAgentLoopConfig(config);
  const { region, project, logstore } = config.agentloop;
  const endpoint = observabilityUrl(process.env.AGENTLOOP_SLS_ENDPOINT || `https://${project}.${region}.log.aliyuncs.com`, 'AgentLoop SLS');
  if (new URL(endpoint).pathname !== '/') throw new TracingError(400, 'AgentLoop SLS 接入点须为 Project 域名');
  credential ??= new Credential();
  let keys;
  try { keys = await credential.getCredential(); }
  catch { throw new TracingError(503, 'AgentLoop 查询凭证不可用，请配置 Dashboard 服务端阿里云凭证链'); }
  if (!keys.accessKeyId || !keys.accessKeySecret) throw new TracingError(503, 'AgentLoop 查询凭证不可用');
  const path = `/logstores/${encodeURIComponent(logstore)}`;
  const params = { type: 'log', from: String(from), to: String(to), query, line: String(line), offset: String(offset), reverse: 'true' };
  for (let attempt = 0; attempt < 3; attempt++) {
    const headers: Record<string, string> = { 'content-type': 'application/json', date: new Date().toUTCString(),
      'x-log-apiversion': '0.6.0', 'x-log-signaturemethod': 'hmac-sha1', 'x-log-bodyrawsize': '0' };
    if (keys.securityToken) headers['x-acs-security-token'] = keys.securityToken;
    const canonicalHeaders = Object.keys(headers).filter((k) => k.startsWith('x-log-') || k.startsWith('x-acs-')).sort().map((k) => `${k}:${headers[k]}\n`).join('');
    const resource = `${path}?${Object.keys(params).sort().map((k) => `${k}=${params[k as keyof typeof params]}`).join('&')}`;
    headers.authorization = `LOG ${keys.accessKeyId}:${createHmac('sha1', keys.accessKeySecret).update(`GET\n\napplication/json\n${headers.date}\n${canonicalHeaders}${resource}`).digest('base64')}`;
    let response: Response;
    try { response = await fetch(`${endpoint}${path}?${new URLSearchParams(params)}`, { headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(10000) }); }
    catch { throw new TracingError(502, '无法连接 AgentLoop Trace 数据源'); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new TracingError(502, `AgentLoop 查询失败（HTTP ${response.status}）`);
    }
    const progress = response.headers.get('x-log-progress');
    if (progress !== 'Complete') {
      await response.body?.cancel();
      if (progress === 'Incomplete') continue;
      throw new TracingError(502, 'AgentLoop 查询缺少完整性标记');
    }
    const rows = await response.json();
    if (!Array.isArray(rows)) throw new TracingError(502, 'AgentLoop Trace 数据格式无效');
    return rows as Row[];
  }
  throw new TracingError(503, 'AgentLoop 查询尚未完整，请缩小范围或稍后重试');
}

async function allRows(config: ObservabilityConfig, query: string, from: number): Promise<Row[]> {
  const result: Row[] = [];
  const to = Math.floor(Date.now() / 1000) + 1;
  const deadline = Date.now() + 60000;
  let bytes = 0;
  for (let offset = 0; offset < 100000 && Date.now() < deadline;) {
    const rows = await page(config, query, from, to, offset);
    if (!rows.length) return result;
    bytes += Buffer.byteLength(JSON.stringify(rows));
    if (bytes > 32 * 1024 * 1024) break;
    result.push(...rows); offset += rows.length;
  }
  throw new TracingError(503, 'AgentLoop 查询范围过大，请增加筛选；未返回不完整结果');
}

export async function listTraces(search: URLSearchParams, scope: TraceScope, config: ObservabilityConfig): Promise<TraceList> {
  const current = search.get('page') ?? '1';
  if (!/^[1-9]\d{0,4}$/.test(current)) throw new TracingError(400, '无效页码');
  const worker = search.get('worker'); const team = search.get('team');
  if ((worker && !scope.workers.some((w) => w.name === worker)) || (team && !scope.teams.some((t) => t.name === team))) throw new TracingError(404, '资源不存在或无权访问');
  const allowed = { ...scope, workers: scope.workers.filter((w) => (!worker || w.name === worker) && (!team || w.team === team)) };
  const empty = { data: [], meta: { page: Number(current), totalPages: 0, totalItems: 0 } };
  if (!allowed.workers.length) return empty;
  const hours = Number(search.get('hours') ?? '24');
  if (![1, 24, 168].includes(hours)) throw new TracingError(400, '无效时间范围');
  const conditions = [workerQuery(allowed), 'attributes.gen_ai.span.kind:"ENTRY"'];
  const fields = { session: 'gen_ai.session.id', runtime: 'agentteams.runtime', task: 'agentteams.task.id', team: 'agentteams.team.id', room: 'agentteams.room.id', project: 'agentteams.project.id' };
  for (const [filter, field] of Object.entries(fields)) if (search.get(filter)) conditions.push(term(`attributes.${field}`, search.get(filter)!));
  const rows = await allRows(config, conditions.join(' AND '), search.get('session') ? 0 : Math.floor(Date.now() / 1000) - hours * 3600);
  const unique = new Map<string, TraceSummary>();
  for (const row of rows) {
    const attrs = attributes(row);
    if (attrs['gen_ai.span.kind'] !== 'ENTRY') continue;
    const trace = summary(row);
    if (traceInScope(trace, allowed) && Object.entries(fields).every(([filter, field]) => !search.get(filter) || attrs[field] === search.get(filter))) unique.set(trace.id, trace);
  }
  const data = [...unique.values()].sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return { data: data.slice((Number(current) - 1) * 20, Number(current) * 20), meta: { page: Number(current), totalPages: Math.ceil(data.length / 20), totalItems: data.length } };
}

export async function getTrace(id: string, scope: TraceScope, config: ObservabilityConfig): Promise<TraceDetail> {
  if (!/^[a-f0-9]{32}$/i.test(id)) throw new TracingError(400, '无效 Trace ID');
  if (!scope.workers.length) throw new TracingError(404, 'Trace 不存在或无权访问');
  const rows = (await allRows(config, `${workerQuery(scope)} AND ${term('traceId', id)}`, 0)).filter((r) => r.traceId === id);
  const root = rows.find((r) => attributes(r)['gen_ai.span.kind'] === 'ENTRY' && traceInScope(summary(r), scope));
  if (!root) throw new TracingError(404, 'Trace 不存在或无权访问');
  const trace = summary(root);
  const own = rows.filter((r) => { const attrs = attributes(r); return attrs['agentteams.worker.name'] === trace.userId && attrs['agentteams.team.id'] === trace.metadata['agentteams.team.id']; });
  return { ...trace, metadata: attributes(root), backend: 'agentloop', backendUrl: 'https://agentloop.console.aliyun.com/', langfuseUrl: null,
    observations: [...new Map(own.map((r) => [String(r.spanId), observation(r)])).values()] };
}

export async function testAgentLoopConnection(config: ObservabilityConfig) {
  const now = Math.floor(Date.now() / 1000);
  await page(config, 'attributes.gen_ai.span.kind:"ENTRY" AND attributes.agentteams.worker.name:"__connection_check__"', now - 60, now + 1, 0, 1);
  return { projectId: config.agentloop.project, projectName: `AgentLoop / ${config.agentloop.workspace}`, source: 'dashboard',
    message: 'Trace 数据源查询认证成功；Collector 可达不代表云上入库，需运行 Worker 任务验证。' };
}
