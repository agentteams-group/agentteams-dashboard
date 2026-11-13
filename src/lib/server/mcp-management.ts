import { randomBytes } from 'node:crypto';
import { NextRequest } from 'next/server';
import { parse, stringify } from 'yaml';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { pickBackendUrl } from '@/lib/backend-config';
import { callHigressConsole, collectSetCookieHeader, getHigressConsoleURL } from '@/app/api/higress/proxy-helper';
import { getSessionCookie, isRecord, unwrapData } from '@/app/api/higress/helpers';
import { getControllerUrl, proxyToAgentTeams } from '@/app/api/agentteams/proxy-helper';
import { mergeMcpSecrets, publicMcpConnection, validateMcpInput, type McpConnection, type McpManagedInput, type McpVerification } from '@/lib/mcp-management';
import { listMcpTools, withMcpClient } from './mcp-client';

export interface ManagedMcpRecord extends McpManagedInput {
  managed: true;
  url: string;
  transport: 'streaminghttp' | 'sse';
  createdAt: string;
  updatedAt: string;
  gatewayState: 'ready' | 'error';
  authorizedWorkers: string[];
  pendingRemovalWorkers?: string[];
  workerConsumers?: Record<string, string>;
  verification?: McpVerification;
  probe: { name: string; key: string };
}

export class McpManagementError extends Error {
  status: number;
  constructor(message: string, status = 400) { super(message); this.status = status; }
}

const PARAMETER_PLUGIN = 'agentteams-mcp-headers';
let adminSession: { url: string; cookie: string } | undefined;
// Next bundles legacy and managed routes separately; share the same lock map
// across their module instances, just like the Dashboard session store.
const processState = globalThis as typeof globalThis & { __agentteamsMcpWrites?: Map<string, Promise<void>> };
const writes = processState.__agentteamsMcpWrites ??= new Map<string, Promise<void>>();

/** Serialize this Dashboard process's writes, including legacy registration. */
export async function withMcpRecordLock<T>(name: string, action: () => Promise<T>): Promise<T> {
  const previous = writes.get(name);
  let release!: () => void;
  const current = new Promise<void>((resolve) => { release = resolve; });
  writes.set(name, current);
  await previous;
  try { return await action(); }
  finally { release(); if (writes.get(name) === current) writes.delete(name); }
}

async function consoleApi(request: NextRequest, path: string, method = 'GET', body?: Record<string, unknown>): Promise<unknown> {
  let cookie = getSessionCookie(request);
  const url = getHigressConsoleURL();
  let result = await callHigressConsole(path, { method, body, cookie: adminSession?.url === url ? adminSession.cookie : cookie });
  if (result.response.status === 401 || result.response.status === 403) {
    // Only called behind the level-3 gate. These are operator-configured,
    // server-only credentials; a Controller token is never sent to Console.
    const username = process.env.AGENTTEAMS_ADMIN_USER;
    const password = process.env.AGENTTEAMS_ADMIN_PASSWORD;
    if (!username || !password) throw new McpManagementError('网关管理会话未连接，请使用 Higress 管理员账号登录 Dashboard。', 401);
    const login = await callHigressConsole('/session/login', { method: 'POST', body: { username, password } });
    cookie = login.response.ok ? collectSetCookieHeader(login.response.headers) ?? null : null;
    if (!cookie) throw new McpManagementError('无法连接网关管理会话，请检查部署中的管理员凭证。', 503);
    adminSession = { url, cookie };
    result = await callHigressConsole(path, { method, body, cookie });
  }
  if (method === 'GET' && result.response.status === 404 && /^\/v1\/(consumers|mcpServer|wasm-plugins|service-sources)\/[^/]+$/.test(path)) return null;
  if (method === 'DELETE' && result.response.status === 404 && /^\/v1\/(consumers|mcpServer)\/[^/]+$/.test(path)) return null;
  if (!result.response.ok || (isRecord(result.body) && result.body.success === false)) {
    throw new McpManagementError(`网关操作失败（HTTP ${result.response.status}）。请检查服务来源、插件与网关配置后重试。`, result.response.status === 409 ? 409 : 502);
  }
  return unwrapData(result.body);
}

function bucket() {
  const value = getMinioBucket();
  if (!value) throw new McpManagementError('MinIO 未配置。', 503);
  return value;
}

export async function readMcpRecord(name: string): Promise<ManagedMcpRecord | null> {
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) throw new McpManagementError('MCP 名称不合法。');
  try {
    const stream = await createMinioClient().getObject(bucket(), `mcp-servers/${name}.json`);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    return JSON.parse(Buffer.concat(chunks).toString()) as ManagedMcpRecord;
  } catch (error) {
    if (isRecord(error) && ['NoSuchKey', 'NotFound', 'NoSuchObject'].includes(String(error.code))) return null;
    throw error;
  }
}

async function writeRecord(record: ManagedMcpRecord) {
  const data = Buffer.from(JSON.stringify(record));
  await createMinioClient().putObject(bucket(), `mcp-servers/${record.name}.json`, data, data.length, { 'Content-Type': 'application/json' });
}

export function publicMcpRecord(record: ManagedMcpRecord, includeConnection = true) {
  const { probe: _, connection, verification, authorizedWorkers, pendingRemovalWorkers, workerConsumers: __, ...rest } = record;
  const active = authorizedWorkers.filter((name) => !pendingRemovalWorkers?.includes(name));
  const summary = { ...rest, kind: connection.kind, toolCount: verification?.tools?.length ?? 0, authorizedWorkerCount: active.length,
    verification: verification ? { success: verification.success, message: verification.message, checkedAt: verification.checkedAt } : undefined };
  return includeConnection ? { ...summary, connection: publicMcpConnection(connection), authorizedWorkers: active, pendingRemovalWorkers, verification } : summary;
}

function gatewayBase(): URL {
  const raw = pickBackendUrl('higress-gateway') || process.env.AGENTTEAMS_AI_GATEWAY_URL || 'http://aigw-local.agentteams.io:8080';
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new McpManagementError('网关数据面地址配置不正确。', 503);
  return url;
}

export function backendParameters(c: McpConnection) {
  const headers: Record<string, string> = Object.fromEntries(c.headers.map((row) => [row.name, row.value]));
  const query = Object.fromEntries(c.query.map((row) => [row.name, row.value]));
  const auth = c.auth;
  if (auth.type === 'bearer') headers.Authorization = `Bearer ${auth.secret}`;
  if (auth.type === 'basic') headers.Authorization = `Basic ${Buffer.from(`${auth.username}:${auth.secret}`).toString('base64')}`;
  if (auth.type === 'api-key') (auth.in === 'query' ? query : headers)[auth.name!] = auth.secret!;
  return { headers, query };
}

/** The visual editor deliberately uses templates supported by deployed Higress. */
export function compileRestConfig(input: McpManagedInput) {
  const c = input.connection;
  const base = new URL(c.backendUrl);
  const { headers, query } = backendParameters(c);
  let config: Record<string, unknown>;
  if (c.rawConfig?.trim()) {
    const parsed: unknown = parse(c.rawConfig, { maxAliasCount: 0 });
    if (!isRecord(parsed) || !Array.isArray(parsed.tools) || !parsed.tools.length) throw new McpManagementError('YAML 必须包含非空的 tools 列表。');
    config = parsed;
  } else {
    config = { tools: c.tools.map((tool) => {
      const fixedQuery = new URLSearchParams(query).toString();
      return { name: tool.name, description: tool.description,
        args: tool.parameters.map((p) => ({ name: p.name, description: p.description || p.name, type: p.type, required: p.required, position: p.position })),
        requestTemplate: { method: tool.method, url: `${base.origin}${base.pathname.replace(/\/$/, '')}${tool.path}${fixedQuery ? `${tool.path.includes('?') ? '&' : '?'}${fixedQuery}` : ''}`, headers: Object.entries(headers).map(([key, value]) => ({ key, value })),
          ...(tool.parameters.some((p) => p.position === 'body') ? { argsToJsonBody: true } : {}),
        },
      };
    }) };
  }
  const tools = config.tools as Record<string, unknown>[];
  const names = new Set<string>();
  for (const tool of tools) {
    if (!isRecord(tool) || typeof tool.name !== 'string' || names.has(tool.name) || !isRecord(tool.requestTemplate) || typeof tool.requestTemplate.url !== 'string') throw new McpManagementError('工具定义不完整，名称须唯一并包含 requestTemplate.url。');
    names.add(tool.name);
    // Route services have one origin. Silently accepting unrelated origins
    // would send tools to the wrong backend.
    if (!tool.requestTemplate.url.startsWith(base.origin + '/')) throw new McpManagementError(`工具 ${tool.name} 的 URL 必须属于已配置的后端 ${base.origin}。`);
    if (c.rawConfig?.trim()) {
      const existing = Array.isArray(tool.requestTemplate.headers) ? tool.requestTemplate.headers.filter((h) => {
        if (!isRecord(h) || typeof h.key !== 'string') return false;
        const headerName = h.key.toLowerCase();
        return !Object.keys(headers).some((key) => key.toLowerCase() === headerName);
      }) : [];
      tool.requestTemplate.headers = [...existing, ...Object.entries(headers).map(([key, value]) => ({ key, value }))];
      const suffix = new URLSearchParams(query).toString();
      if (suffix) tool.requestTemplate.url += `${tool.requestTemplate.url.includes('?') ? '&' : '?'}${suffix}`;
    }
  }
  // Server credentials are configured only through the connection form.
  return stringify({ server: { name: input.name, type: 'rest' }, tools });
}

async function ensureParameterPlugin(request: NextRequest) {
  const existing = await consoleApi(request, `/v1/wasm-plugins/${PARAMETER_PLUGIN}`);
  if (isRecord(existing) && existing.name === PARAMETER_PLUGIN) {
    if (existing.phase !== 'AUTHZ' || existing.priority !== 10) throw new McpManagementError('MCP 参数插件名称已被其他配置占用。', 409);
    return;
  }
  const template = await consoleApi(request, '/v1/wasm-plugins/transformer');
  if (!isRecord(template) || typeof template.imageRepository !== 'string') throw new McpManagementError('网关缺少请求转换插件。', 503);
  await consoleApi(request, '/v1/wasm-plugins', 'POST', { ...template, version: undefined, name: PARAMETER_PLUGIN, builtIn: false,
    title: 'AgentTeams MCP upstream parameters', description: 'Scoped MCP backend headers after Consumer authentication', phase: 'AUTHZ', priority: 10 });
}

async function applyGateway(request: NextRequest, record: ManagedMcpRecord) {
  const c = record.connection;
  const gateway = gatewayBase();
  {
    const target = c.kind === 'database' ? new URL(`http://${c.database!.host}:${c.database!.port}`) : new URL(c.backendUrl);
    const service = { type: 'dns', name: `at-mcp-${record.name}`, domain: target.hostname, port: Number(target.port || (target.protocol === 'https:' ? 443 : 80)), protocol: target.protocol.slice(0, -1) };
    const source = await consoleApi(request, `/v1/service-sources/${service.name}`);
    if (!source) await consoleApi(request, '/v1/service-sources', 'POST', service);
    else if (isRecord(source) && (source.domain !== service.domain || source.port !== service.port || source.protocol !== service.protocol)) {
      await consoleApi(request, `/v1/service-sources/${service.name}`, 'PUT', { ...source, ...service });
    }
  }
  const consumers = [record.probe.name, ...record.authorizedWorkers.filter((name) => !record.pendingRemovalWorkers?.includes(name)).map((name) => record.workerConsumers?.[name] ?? `worker-${name}`)];
  const consumer = await consoleApi(request, `/v1/consumers/${record.probe.name}`);
  if (!consumer) await consoleApi(request, '/v1/consumers', 'POST', { name: record.probe.name, credentials: [{ type: 'key-auth', source: 'BEARER', values: [record.probe.key] }] });
  const payload: Record<string, unknown> = { name: record.name, description: record.description || '', domains: [gateway.hostname],
    consumerAuthInfo: { type: 'key-auth', enable: true, allowedConsumers: consumers },
  };
  if (c.kind === 'database') {
    payload.type = 'DATABASE'; payload.dbType = c.database!.type;
    const { type: _, configured: __, ...db } = c.database!;
    payload.dbConfig = { ...db, port: String(db.port) };
    payload.services = [{ name: `at-mcp-${record.name}.dns`, port: c.database!.port, weight: 100 }];
  } else {
    const target = new URL(c.backendUrl);
    payload.services = [{ name: `at-mcp-${record.name}.dns`, port: Number(target.port || (target.protocol === 'https:' ? 443 : 80)), weight: 100 }];
    if (c.kind === 'rest') { payload.type = 'OPEN_API'; payload.rawConfigurations = compileRestConfig(record); }
    else { payload.type = 'DIRECT_ROUTE'; payload.directRouteConfig = { path: target.pathname, transportType: c.transport === 'sse' ? 'sse' : 'streamable' }; }
  }
  await consoleApi(request, '/v1/mcpServer', 'PUT', payload);
  if (c.kind === 'proxy') {
    await ensureParameterPlugin(request);
    const { headers, query } = backendParameters(c);
    // Consumer authentication happens in AUTHN. This scoped AUTHZ instance
    // replaces that credential with backend auth; it never changes the
    // priority of Higress's shared transformer plugin.
    await consoleApi(request, `/v1/routes/mcp-server-${record.name}.internal/plugin-instances/${PARAMETER_PLUGIN}`, 'PUT', { enabled: true, configurations: { reqRules: [
      { operate: 'remove', headers: [...new Set(['Authorization', ...Object.keys(headers)])].map((key) => ({ key })), querys: Object.keys(query).map((key) => ({ key })) },
      { operate: 'add', headers: Object.entries(headers).map(([key, value]) => ({ key, value })), querys: Object.entries(query).map(([key, value]) => ({ key, value })) },
    ] } });
  }
}

export async function saveManagedMcp(request: NextRequest, input: McpManagedInput) {
  return withMcpRecordLock(input?.name ?? '', () => saveManagedMcpLocked(request, input));
}

async function saveManagedMcpLocked(request: NextRequest, input: McpManagedInput) {
  if (!isRecord(input) || typeof input.name !== 'string' || !isRecord(input.connection)) throw new McpManagementError('服务配置格式不正确。');
  const validation = validateMcpInput(input);
  if (validation) throw new McpManagementError(validation);
  const existing = await readMcpRecord(input.name);
  if (existing && !existing.managed) throw new McpManagementError('名称已被地址登记占用，请使用其他名称。', 409);
  if (existing && existing.connection.kind !== input.connection.kind) throw new McpManagementError('已启用服务不能切换接入方式，请创建新服务。', 409);
  if (existing?.authorizedWorkers.length && input.connection.kind === 'proxy' && existing.connection.transport !== input.connection.transport) throw new McpManagementError('请先移除 Agent 授权，再修改后端传输协议。', 409);
  const now = new Date().toISOString();
  const connection = mergeMcpSecrets(input.connection, existing?.connection);
  const mergedValidation = validateMcpInput({ ...input, connection });
  if (mergedValidation) throw new McpManagementError(mergedValidation);
  const gateway = gatewayBase();
  const url = new URL(`/mcp-servers/${input.name}${connection.kind === 'proxy' && connection.transport === 'sse' ? '/sse' : ''}`, gateway).toString();
  const record: ManagedMcpRecord = { ...input, connection, managed: true, url,
    transport: connection.kind === 'proxy' ? connection.transport : 'streaminghttp',
    authorizedWorkers: existing?.authorizedWorkers ?? [], gatewayState: 'error', createdAt: existing?.createdAt ?? now, updatedAt: now,
    pendingRemovalWorkers: existing?.pendingRemovalWorkers, workerConsumers: existing?.workerConsumers,
    probe: existing?.probe ?? { name: `at-mcp-check-${randomBytes(6).toString('hex')}`, key: randomBytes(32).toString('hex') },
  };
  if (connection.kind === 'rest') compileRestConfig(record); // preflight before any gateway mutation
  if (!existing) {
    const gatewayRecord = await consoleApi(request, `/v1/mcpServer/${input.name}`);
    const source = await consoleApi(request, `/v1/service-sources/at-mcp-${input.name}`);
    if (gatewayRecord || source) throw new McpManagementError('网关已有同名服务或服务来源，请选择其他名称，原配置不会被覆盖。', 409);
  }
  // Persist retry data before touching remote resources; failures remain
  // editable and are never displayed as ready.
  await writeRecord(record);
  try { await applyGateway(request, record); record.gatewayState = 'ready'; }
  finally { await writeRecord(record); }
  return publicMcpRecord(record);
}

export async function requireManagedMcp(name: string) {
  const record = await readMcpRecord(name);
  if (!record?.managed) throw new McpManagementError('找不到由 Dashboard 接入的 MCP 服务。', 404);
  return record;
}

function redact(record: ManagedMcpRecord, value: unknown): unknown {
  const c = record.connection;
  const secrets = [record.probe.key, c.auth.secret, c.database?.password, ...c.headers.filter((p) => p.secret).map((p) => p.value), ...c.query.filter((p) => p.secret).map((p) => p.value)].filter((s): s is string => Boolean(s));
  if (c.auth.type === 'basic' && c.auth.secret) secrets.push(Buffer.from(`${c.auth.username}:${c.auth.secret}`).toString('base64'));
  const forms = [...new Set(secrets.flatMap((secret) => [secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1)]))];
  const mask = (item: unknown): unknown => {
    if (typeof item === 'string') return forms.reduce((text, form) => text.split(form).join('••••••'), item);
    if (Array.isArray(item)) return item.map(mask);
    if (isRecord(item)) return Object.fromEntries(Object.entries(item).map(([key, field]) => [key, mask(field)]));
    return item;
  };
  return mask(value);
}

export async function verifyManagedMcp(name: string, tool?: string, args?: Record<string, unknown>) {
  const record = await requireManagedMcp(name);
  if (record.gatewayState !== 'ready') throw new McpManagementError('请先重新保存并启用网关配置。', 409);
  const started = Date.now();
  try {
    const result = await withMcpClient(record.url, record.transport, { Authorization: `Bearer ${record.probe.key}` }, record.connection.timeout, async (rpc) => {
      const tools = await listMcpTools(rpc);
      if (tool && !tools.some((item) => item.name === tool)) throw new McpManagementError('工具不存在，请刷新工具列表。');
      return { tools, ...(tool ? { result: await rpc('tools/call', { name: tool, arguments: args ?? {} }) } : {}) };
    });
    const toolFailed = 'result' in result && isRecord(result.result) && result.result.isError === true;
    const verification = redact(record, { success: !toolFailed, message: `${tool ? toolFailed ? '工具返回业务错误' : '工具调用完成' : `网关验证通过，发现 ${result.tools.length} 个工具`} · ${Date.now() - started} ms`, ...result, checkedAt: new Date().toISOString() }) as McpVerification;
    return tool ? verification : persistVerification(record, verification);
  } catch (error) {
    if (tool) throw error;
    const message = record.connection.kind === 'database'
      ? '数据库 MCP 验证未通过，请检查网关是否已开启数据库 MCP 能力，以及数据库连接、TLS 和账号权限。'
      : error instanceof Error ? error.message : 'MCP 验证失败。';
    const verification: McpVerification = { success: false, message, checkedAt: new Date().toISOString() };
    return persistVerification(record, verification);
  }
}

async function persistVerification(record: ManagedMcpRecord, verification: McpVerification): Promise<McpVerification> {
  return withMcpRecordLock(record.name, async () => {
    const latest = await readMcpRecord(record.name);
    if (!latest?.managed || latest.updatedAt !== record.updatedAt) return { success: false, message: '验证期间服务配置已更新，请使用最新配置重新验证。' };
    await writeRecord({ ...latest, verification });
    return verification;
  });
}

async function controllerApi(request: NextRequest, path: string, method = 'GET', body?: Record<string, unknown>) {
  const headers = new Headers(request.headers); headers.set('content-type', 'application/json');
  const forwarded = new NextRequest(request.url, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
  const res = await proxyToAgentTeams(forwarded, getControllerUrl(request), `/api/v1${path}`, { method, forwardBody: Boolean(body) });
  if (!res.ok) throw new McpManagementError(`Agent 配置更新失败（HTTP ${res.status}），请重试。`, res.status === 404 ? 404 : 502);
  return res.json();
}

export async function authorizeManagedMcp(request: NextRequest, name: string, workers: string[]) {
  return withMcpRecordLock(name, () => authorizeManagedMcpLocked(request, name, workers));
}

async function authorizeManagedMcpLocked(request: NextRequest, name: string, workers: string[]) {
  if (!Array.isArray(workers) || workers.length > 100 || workers.some((w) => typeof w !== 'string' || !/^[a-zA-Z0-9][\w.-]*$/.test(w))) throw new McpManagementError('Agent 选择不合法。');
  const record = await requireManagedMcp(name);
  if (record.gatewayState !== 'ready') throw new McpManagementError('请先启用网关配置。', 409);
  const desired = [...new Set(workers)];
  const previous = record.authorizedWorkers;
  const results: { name: string; success: boolean; message: string }[] = [];
  for (const workerName of new Set([...previous, ...desired, ...(record.pendingRemovalWorkers ?? [])])) {
    const enable = desired.includes(workerName);
    let revoked = false;
    try {
      const knownConsumer = record.workerConsumers?.[workerName] ?? `worker-${workerName}`;
      // Persist revocation before touching Controller: a failed spec update
      // must never cause a later connection edit to restore gateway access.
      if (!enable) {
        record.pendingRemovalWorkers = [...new Set([...(record.pendingRemovalWorkers ?? []), workerName])];
        await writeRecord(record); // durable intent before the remote permission change
        await consoleApi(request, '/v1/mcpServer/consumers', 'DELETE', { mcpServerName: name, consumers: [knownConsumer] });
        revoked = true;
        record.authorizedWorkers = record.authorizedWorkers.filter((n) => n !== workerName);
        await writeRecord(record);
      }
      let worker;
      try { worker = await controllerApi(request, `/workers/${encodeURIComponent(workerName)}`); }
      catch (error) {
        if (enable || !(error instanceof McpManagementError) || error.status !== 404) throw error;
        // The Worker no longer exists; gateway revocation is still required.
        worker = { name: workerName, mcpServers: [] };
      }
      const consumerName = `worker-${worker.workerName || worker.name || workerName}`;
      const servers = Array.isArray(worker.mcpServers) ? worker.mcpServers.filter((s: { name: string }) => s.name !== name) : [];
      if (enable) servers.push({ name, url: record.url, transport: record.transport === 'streaminghttp' ? 'http' : 'sse' });
      if (!enable && knownConsumer !== consumerName) await consoleApi(request, '/v1/mcpServer/consumers', 'DELETE', { mcpServerName: name, consumers: [consumerName] });
      // A missing Worker needs no spec cleanup.
      if (enable || (Array.isArray(worker.mcpServers) && worker.mcpServers.length)) await controllerApi(request, `/workers/${encodeURIComponent(workerName)}`, 'PUT', { mcpServers: servers });
      if (enable) {
        try { await consoleApi(request, '/v1/mcpServer/consumers', 'PUT', { mcpServerName: name, consumers: [consumerName] }); }
        catch {
          await controllerApi(request, `/workers/${encodeURIComponent(workerName)}`, 'PUT', { mcpServers: worker.mcpServers ?? [] });
          throw new McpManagementError('网关授权失败，已恢复原 Agent 配置，请重试。', 502);
        }
      }
      record.authorizedWorkers = enable ? [...new Set([...record.authorizedWorkers, workerName])] : record.authorizedWorkers.filter((n) => n !== workerName);
      record.pendingRemovalWorkers = (record.pendingRemovalWorkers ?? []).filter((n) => n !== workerName);
      record.workerConsumers = { ...record.workerConsumers, [workerName]: consumerName };
      await writeRecord(record);
      results.push({ name: workerName, success: true, message: enable ? '已保存配置并提交授权；网关生效后可验证实际调用权限。' : '已移除配置并提交撤销授权。' });
    } catch (error) { results.push({ name: workerName, success: false, message: revoked ? '网关权限已撤销，Agent 配置尚未移除，请重试同步。' : error instanceof Error ? error.message : '更新失败。' }); }
  }
  return { success: results.every((r) => r.success), results, authorizedWorkers: record.authorizedWorkers.filter((name) => !record.pendingRemovalWorkers?.includes(name)), pendingRemovalWorkers: record.pendingRemovalWorkers ?? [] };
}

export async function deleteManagedMcp(request: NextRequest, name: string) {
  return withMcpRecordLock(name, () => deleteManagedMcpLocked(request, name));
}

async function deleteManagedMcpLocked(request: NextRequest, name: string) {
  const record = await requireManagedMcp(name);
  if (record.authorizedWorkers.length || record.pendingRemovalWorkers?.length) throw new McpManagementError('请先在 Agent 授权中移除所有 Agent 并完成配置同步，再删除服务。', 409);
  const workers = await controllerApi(request, '/workers');
  const workerList = Array.isArray(workers) ? workers : workers.workers;
  if (!Array.isArray(workerList)) throw new McpManagementError('无法确认 Agent 的 MCP 使用情况，请稍后重试。', 502);
  let managers;
  try { managers = await controllerApi(request, '/managers'); }
  catch (error) { if (error instanceof McpManagementError && error.status === 404) managers = []; else throw error; }
  const managerList = Array.isArray(managers) ? managers : managers.managers;
  if (!Array.isArray(managerList)) throw new McpManagementError('无法确认 Manager 的 MCP 使用情况，请稍后重试。', 502);
  if ([...workerList, ...managerList].some((agent) => Array.isArray(agent.mcpServers) && agent.mcpServers.some((server: { name: string }) => server.name === name))) throw new McpManagementError('仍有 Agent 配置引用此服务，请先移除对应 MCP 配置。', 409);
  await consoleApi(request, `/v1/mcpServer/${name}`, 'DELETE');
  await consoleApi(request, `/v1/consumers/${record.probe.name}`, 'DELETE');
  // DNS sources are left in place: other gateway routes may reference them.
  await createMinioClient().removeObject(bucket(), `mcp-servers/${name}.json`);
  return { success: true };
}

export async function importMcpOpenApi(request: NextRequest, content: string) {
  if (typeof content !== 'string' || !content.trim() || content.length > 512000) throw new McpManagementError('OpenAPI 文档不能为空，大小不能超过 500 KB。');
  const result = await consoleApi(request, '/v1/mcpServer/swaggerToMcpConfig', 'POST', { content });
  if (typeof result !== 'string') throw new McpManagementError('网关未返回有效的工具定义。', 502);
  const parsed: unknown = parse(result, { maxAliasCount: 0 });
  if (!isRecord(parsed) || !Array.isArray(parsed.tools)) throw new McpManagementError('未在 OpenAPI 文档中发现可转换的工具。');
  return { rawConfig: stringify({ tools: parsed.tools }), toolCount: parsed.tools.length };
}

export async function mcpCapabilities(request: NextRequest) {
  await consoleApi(request, '/v1/mcpServer?pageSize=1');
  return { available: true, kinds: ['proxy', 'rest', 'database'], gateway: gatewayBase().origin };
}
