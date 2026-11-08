// Worker MCP 合并视图的共享纯函数（服务端路由与客户端面板共用）。
//
// 数据两路：
// - declared = worker detail `spec.mcpServers`（Controller /workers 透传）。
// - self-registered = Controller `GET /api/v1/workers/{name}/mcp` 只读代理
//   （worker 侧 QwenPaw mcp.clients 注册表，内置插件 teamharness/workerflow
//   等自注册条目）。
//
// 归一化规则与工作台插件（WorkerMcpPanel.tsx / worker_mcp_api.py）对齐：
// - 身份 name 取 key（QwenPaw MCPClientInfo 的唯一标识，与 CRD 声明同源），
//   name/id/server 兜底；显示名另存 displayName（与 key 不同时不拆行）。
// - transport 取 transport，type 兜底；enabled 取 enabled，disabled 取反兜底。
// - env/headers 只留键名（值恒 ***）——运行时注入的凭据永不下发浏览器。
// - command/args 的 /home/<user>、/root 用户名段换 ~。
// - url 剥 scheme://user:pass@ 内嵌凭据。
// 上游形态未定案，归一化防御性接受：条目数组 / 包装对象（items/mcpServers/
// servers/mcp/clients/mcp_servers）/ name→config 映射；非对象与无名条目跳过
// （不伪造）。

/** 自注册 MCP 条目（归一化 + 脱敏后）。 */
export interface WorkerMcpItem {
  /** 稳定标识（QwenPaw MCPClientInfo.key；与 CRD 声明按此合并）。 */
  name: string;
  /** 显示名（MCPClientInfo.name，可与 key 不同）。 */
  displayName?: string;
  enabled?: boolean;
  transport?: string;
  command?: string;
  args?: string[];
  url?: string;
  /** 只含键名——值由归一化丢弃，永不携带。 */
  envKeys?: string[];
  /** 只含键名——值由归一化丢弃，永不携带。 */
  headerKeys?: string[];
  /** 上游可能携带的来源标记（原样透传，未知形态省略）。 */
  source?: string;
}

export interface WorkerMcpResult {
  available: boolean;
  /** available=false 时的原因：controller_too_old / no_token / forbidden / unsupported。 */
  reason?: string;
  items: WorkerMcpItem[];
}

/** CRD 声明条目（worker detail `spec.mcpServers` 的最小形状）。 */
export interface DeclaredMcpServer {
  name: string;
  url: string;
  transport: string;
}

/** 合并行：两路按 name 对齐，各自条目原样保留（字段冲突展示时自注册优先）。 */
export interface MergedWorkerMcpRow {
  name: string;
  declared?: DeclaredMcpServer;
  self?: WorkerMcpItem;
}

// 包装对象里装列表/映射的候选键（按序取第一个命中的）。
const WRAPPER_KEYS = ['items', 'mcpServers', 'servers', 'mcp', 'clients', 'mcp_servers'] as const;

// 用户名段：/home/<user> 或 /root（整段或作为绝对路径前缀）。
const HOME_RE = /^\/(?:home\/[^/]+|root)(?=\/|$)/;

// URL userinfo：scheme://user:pass@host → 剥 user:pass@。
const URL_USERINFO_RE = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/@\s]+@)(.*)$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** 绝对路径用户名段 → ~（/home/lsw/x → ~/x；/root → ~）。 */
export function tildeMcpPath(value: string): string {
  return value.replace(HOME_RE, '~');
}

/** 剥 URL 内嵌凭据 user:pass@（scheme://user:pass@host → scheme://host）。 */
export function redactMcpUrl(value: string): string {
  const match = URL_USERINFO_RE.exec(value);
  return match ? match[1] + match[3] : value;
}

function maskedKeys(value: unknown): string[] | undefined {
  const record = asRecord(value);
  return record ? Object.keys(record) : undefined;
}

function stringArray(value: unknown, transform: (_input: string) => string): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map(transform);
}

function normalizeEntry(nameCandidate: unknown, config: unknown): WorkerMcpItem | null {
  const name = trimmedString(nameCandidate);
  if (!name) return null;
  const cfg = asRecord(config) ?? {};

  const displayName = trimmedString(cfg.displayName ?? cfg.display_name ?? cfg.name);
  let enabled: boolean | undefined;
  if (typeof cfg.enabled === 'boolean') enabled = cfg.enabled;
  else if (typeof cfg.disabled === 'boolean') enabled = !cfg.disabled;

  const transport = trimmedString(cfg.transport) || trimmedString(cfg.type);
  const url = redactMcpUrl(trimmedString(cfg.url) || trimmedString(cfg.endpoint));
  const command = tildeMcpPath(trimmedString(cfg.command));
  const args = stringArray(cfg.args, tildeMcpPath);
  const envKeys = maskedKeys(cfg.env);
  const headerKeys = maskedKeys(cfg.headers);
  const source = trimmedString(cfg.source);

  const item: WorkerMcpItem = { name };
  if (displayName && displayName !== name) item.displayName = displayName;
  if (enabled !== undefined) item.enabled = enabled;
  if (transport) item.transport = transport;
  if (url) item.url = url;
  if (command) item.command = command;
  if (args.length > 0) item.args = args;
  if (envKeys && envKeys.length > 0) item.envKeys = envKeys;
  if (headerKeys && headerKeys.length > 0) item.headerKeys = headerKeys;
  if (source) item.source = source;
  return item;
}

/** 上游条目身份：key（唯一标识）优先，name/id/server 兜底。 */
function entryIdentity(entry: Record<string, unknown>): string {
  for (const key of ['key', 'name', 'id', 'server']) {
    const value = trimmedString(entry[key]);
    if (value) return value;
  }
  return '';
}

/**
 * Controller 原始响应 → 脱敏后的自注册条目列表。
 *
 * 服务端路由用它在边界处做白名单归一化（env/headers 值不进入浏览器）：
 * 200 也按此形状下发，客户端拿到的是已脱敏数据。
 */
export function normalizeWorkerMcpItems(raw: unknown): WorkerMcpItem[] {
  let data = raw;
  const wrapper = asRecord(data);
  if (wrapper) {
    for (const key of WRAPPER_KEYS) {
      const candidate = wrapper[key];
      if (Array.isArray(candidate) || asRecord(candidate)) {
        data = candidate;
        break;
      }
    }
  }

  if (Array.isArray(data)) {
    const items: WorkerMcpItem[] = [];
    for (const entry of data) {
      const record = asRecord(entry);
      if (!record) continue;
      const item = normalizeEntry(entryIdentity(record), record);
      if (item) items.push(item);
    }
    return items;
  }

  // QwenPaw mcp.clients 形态：name → config 映射。
  const mapping = asRecord(data);
  if (mapping) {
    const items: WorkerMcpItem[] = [];
    for (const [name, config] of Object.entries(mapping)) {
      const item = normalizeEntry(name, config);
      if (item) items.push(item);
    }
    return items;
  }

  return [];
}

/**
 * 两路按 name 合并：同一 name 一行，Declared + 自注册双来源；
 * 排序按 name，保证列表稳定。
 */
export function mergeWorkerMcpRows(
  declared?: readonly DeclaredMcpServer[] | null,
  self?: readonly WorkerMcpItem[] | null,
): MergedWorkerMcpRow[] {
  const rows = new Map<string, MergedWorkerMcpRow>();
  for (const entry of declared ?? []) {
    if (!entry?.name) continue;
    rows.set(entry.name, { name: entry.name, declared: entry });
  }
  for (const entry of self ?? []) {
    if (!entry?.name) continue;
    const row = rows.get(entry.name);
    if (row) row.self = entry;
    else rows.set(entry.name, { name: entry.name, self: entry });
  }
  return [...rows.values()].sort((left, right) => left.name.localeCompare(right.name));
}

/** 端点展示：url 优先（自注册 > 声明）；stdio 走 command + args。 */
export function workerMcpEndpoint(row: MergedWorkerMcpRow): string {
  const url = row.self?.url || row.declared?.url || '';
  if (url) return url;
  return [row.self?.command ?? '', ...(row.self?.args ?? [])].join(' ').trim();
}

/** transport：自注册优先，声明兜底。 */
export function workerMcpTransport(row: MergedWorkerMcpRow): string {
  return row.self?.transport || row.declared?.transport || '';
}
