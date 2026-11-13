export type McpKind = 'proxy' | 'rest' | 'database';
export type McpParameterLocation = 'query' | 'path' | 'header' | 'body';

export interface McpFixedParameter {
  name: string;
  value: string;
  secret?: boolean;
  configured?: boolean;
}

export interface McpBackendAuth {
  type: 'none' | 'bearer' | 'basic' | 'api-key';
  username?: string;
  name?: string;
  in?: 'header' | 'query';
  secret?: string;
  configured?: boolean;
}

export interface McpRestTool {
  name: string;
  description: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  path: string;
  parameters: { name: string; description?: string; type: 'string' | 'number' | 'boolean' | 'object' | 'array'; position: McpParameterLocation; required: boolean }[];
}

export interface McpConnection {
  kind: McpKind;
  backendUrl: string;
  transport: 'streaminghttp' | 'sse';
  auth: McpBackendAuth;
  headers: McpFixedParameter[];
  query: McpFixedParameter[];
  timeout: number;
  tools: McpRestTool[];
  rawConfig?: string;
  database?: { type: 'MYSQL' | 'POSTGRESQL' | 'CLICKHOUSE'; host: string; port: number; username: string; password?: string; configured?: boolean; dbname: string };
}

export interface McpManagedInput {
  name: string;
  description?: string;
  connection: McpConnection;
}

export interface McpToolSchema {
  name: string;
  description?: string;
  inputSchema: { type?: string; properties?: Record<string, { type?: string; description?: string; enum?: unknown[]; default?: unknown }>; required?: string[]; [key: string]: unknown };
}

export interface McpVerification {
  success: boolean;
  message: string;
  tools?: McpToolSchema[];
  result?: unknown;
  checkedAt?: string;
}

export const MCP_KIND_LABELS: Record<McpKind, string> = { proxy: '已有 MCP', rest: 'HTTP API 转 MCP', database: '数据库转 MCP' };

export function emptyMcpConnection(): McpConnection {
  return { kind: 'proxy', backendUrl: '', transport: 'streaminghttp', auth: { type: 'none' }, headers: [], query: [], timeout: 15000, tools: [] };
}

/** Empty secret inputs mean keep the stored value; deleting the row removes it. */
export function mergeMcpSecrets(next: McpConnection, previous?: McpConnection): McpConnection {
  const mergeRows = (rows: McpFixedParameter[], old: McpFixedParameter[] = []) => rows.map((row) => ({ ...row,
    value: row.secret && !row.value ? old.find((item) => item.name.toLowerCase() === row.name.toLowerCase() && item.secret)?.value ?? '' : row.value,
    configured: undefined,
  }));
  return { ...next,
    auth: { ...next.auth, secret: next.auth.secret || (next.auth.type === previous?.auth.type ? previous.auth.secret : ''), configured: undefined },
    headers: mergeRows(next.headers, previous?.headers), query: mergeRows(next.query, previous?.query),
    database: next.database ? { ...next.database, password: next.database.password || previous?.database?.password || '', configured: undefined } : undefined,
  };
}

export function publicMcpConnection(connection: McpConnection): McpConnection {
  const maskRows = (rows: McpFixedParameter[]) => rows.map((row) => row.secret ? { ...row, value: '', configured: Boolean(row.value) } : row);
  return { ...connection,
    auth: { ...connection.auth, secret: undefined, configured: Boolean(connection.auth.secret) },
    headers: maskRows(connection.headers), query: maskRows(connection.query),
    database: connection.database ? { ...connection.database, password: undefined, configured: Boolean(connection.database.password) } : undefined,
  };
}

export function validateMcpInput(input: McpManagedInput): string | undefined {
  if (!/^[a-z][a-z0-9-]{0,39}$/.test(input.name)) return '名称须以小写字母开头，可使用小写字母、数字和连字符，最多 40 字符。';
  const c = input.connection;
  if (!c || !['proxy', 'rest', 'database'].includes(c.kind)) return '请选择接入方式。';
  if (!['streaminghttp', 'sse'].includes(c.transport)) return '请选择有效的传输协议。';
  if (!Number.isFinite(c.timeout) || c.timeout < 1000 || c.timeout > 30000) return '超时应在 1,000 到 30,000 毫秒之间。';
  if (!Array.isArray(c.headers) || !Array.isArray(c.query) || !Array.isArray(c.tools)) return '参数格式不正确。';
  if (c.headers.length + c.query.length > 32) return '固定参数最多支持 32 个。';
  if (!c.auth || !['none', 'bearer', 'basic', 'api-key'].includes(c.auth.type)) return '请选择有效的后端认证方式。';
  if (c.auth.type !== 'none' && !c.auth.secret && !c.auth.configured) return '请填写后端认证凭证。';
  if (c.auth.type === 'basic' && !c.auth.username) return '请填写后端用户名。';
  if (c.auth.type === 'api-key' && (!c.auth.name || !['header', 'query'].includes(c.auth.in ?? ''))) return '请填写 API Key 参数名及位置。';
  if (c.auth.type === 'api-key' && (!/^[\w.-]+$/.test(c.auth.name!) || (c.auth.in === 'header' && /^(host|content-length|connection|transfer-encoding|mcp-.*|x-envoy-.*|x-mse-.*)$/i.test(c.auth.name!)))) return 'API Key 参数名无效或由网关协议管理。';
  if (c.auth.secret && /[\r\n]/.test(c.auth.secret)) return '认证凭证不能包含换行。';
  if (c.rawConfig && (typeof c.rawConfig !== 'string' || c.rawConfig.length > 512000)) return '工具 YAML 不能超过 500 KB。';
  for (const [group, rows] of [['Header', c.headers], ['Query', c.query]] as const) {
    const names = new Set<string>();
    for (const row of rows) {
      if (typeof row.name !== 'string' || typeof row.value !== 'string' || !row.name.trim() || /[\r\n]/.test(row.name + row.value)) return `${group} 的名称与值不合法。`;
      const key = group === 'Header' ? row.name.toLowerCase() : row.name;
      if (names.has(key)) return `${group} 参数 ${row.name} 重复。`;
      names.add(key);
      if (group === 'Header' && (!/^[!#$%&'*+.^_`|~\w-]+$/.test(row.name) || /^(host|content-length|connection|transfer-encoding|authorization|mcp-.*|x-envoy-.*|x-mse-.*)$/i.test(row.name))) return `${row.name} 由系统或认证配置管理，请使用其他 Header 名称。`;
    }
  }
  if (c.kind === 'database') {
    const db = c.database;
    if (!db || !['MYSQL', 'POSTGRESQL', 'CLICKHOUSE'].includes(db.type) || !db.host || !db.dbname || !db.username || !Number.isInteger(db.port) || db.port < 1 || db.port > 65535) return '请补全数据库连接信息。';
    return;
  }
  let url: URL;
  try { url = new URL(c.backendUrl); } catch { return '请输入有效的 HTTP(S) 后端地址。'; }
  if (!['http:', 'https:'].includes(url.protocol)) return '请输入有效的 HTTP(S) 后端地址。';
  if (url.username || url.password || url.hash || url.search) return '地址请仅填写协议、主机和路径；Query 参数在高级配置中填写。';
  if (c.kind === 'proxy' && c.transport === 'sse' && !url.pathname.endsWith('/sse')) return '当前网关要求 SSE 后端路径以 /sse 结尾。';
  if (c.kind === 'rest' && !c.rawConfig?.trim()) {
    if (!c.tools.length || c.tools.length > 100) return '请配置 1 到 100 个工具，或导入 OpenAPI 定义。';
    const names = new Set<string>();
    for (const tool of c.tools) {
      if (!/^[a-zA-Z][\w-]*$/.test(tool.name) || names.has(tool.name) || !tool.description.trim() || !tool.path.startsWith('/') || tool.path.startsWith('//') || tool.path.includes('#')) return '工具名称须唯一，并填写说明及以 / 开头的 API 路径。';
      names.add(tool.name);
      if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].includes(tool.method)) return '工具请求方法不正确。';
      const parameters = new Set<string>();
      for (const p of tool.parameters) {
        if (!/^[a-zA-Z_][\w-]*$/.test(p.name) || parameters.has(p.name) || !['query', 'path', 'header', 'body'].includes(p.position) || !['string', 'number', 'boolean', 'object', 'array'].includes(p.type)) return '工具参数名称须唯一，且类型、位置有效。';
        parameters.add(p.name);
        if (p.position === 'header' && /^(authorization|host|content-length|connection|transfer-encoding)$/i.test(p.name)) return '认证 Header 请在后端认证中配置。';
      }
      for (const placeholder of tool.path.matchAll(/\{([\w-]+)\}/g)) if (!tool.parameters.some((p) => p.name === placeholder[1] && p.position === 'path')) return `路径参数 ${placeholder[1]} 尚未定义。`;
    }
  }
}
