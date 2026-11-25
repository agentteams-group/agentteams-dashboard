import type { McpToolSchema } from '@/lib/mcp-management';

type Rpc = { jsonrpc: string; id?: number; result?: Record<string, unknown>; error?: unknown };

/** Read complete SSE events, including frames split across TCP chunks. */
async function* events(body: ReadableStream<Uint8Array>, signal: AbortSignal) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let size = 0;
  try {
    while (!signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 2 * 1024 * 1024) throw new Error('MCP 响应超过 2 MB。');
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      let end: number;
      while ((end = buffer.indexOf('\n\n')) >= 0) {
        const frame = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        yield { event: frame.match(/^event:\s*(.*)$/m)?.[1] ?? 'message', data: frame.split('\n').filter((line) => line.startsWith('data:')).map((line) => line.slice(5).trimStart()).join('\n') };
      }
    }
  } finally { await reader.cancel().catch(() => undefined); }
}

export async function withMcpClient<T>(url: string, transport: 'streaminghttp' | 'sse', headers: Record<string, string>, timeout: number,
  action: (_rpc: (_method: string, _params?: Record<string, unknown>) => Promise<Record<string, unknown>>) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  let session: string | null = null;
  let version = '2025-03-26';
  let nextId = 0;
  let endpoint = url;
  let stream: AsyncGenerator<{ event: string; data: string }> | undefined;
  const common = () => ({ ...headers, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'MCP-Protocol-Version': version, ...(session ? { 'Mcp-Session-Id': session } : {}) });
  async function send(payload: Record<string, unknown>) {
    const res = await fetch(endpoint, { method: 'POST', headers: common(), body: JSON.stringify(payload), signal: controller.signal, redirect: 'error' });
    if (!res.ok) { await res.body?.cancel(); throw new Error(`MCP 返回 HTTP ${res.status}，请检查网关授权、后端凭证和服务地址。`); }
    session = res.headers.get('Mcp-Session-Id') ?? session;
    return res;
  }
  async function rpc(method: string, params: Record<string, unknown> = {}) {
    const id = ++nextId;
    const response = await send({ jsonrpc: '2.0', id, method, params });
    let envelope: Rpc | undefined;
    const iterator = stream ?? (response.body && response.headers.get('content-type')?.includes('text/event-stream') ? events(response.body, controller.signal) : undefined);
    if (iterator) {
      if (stream) await response.body?.cancel();
      while (true) {
        const next = await iterator.next();
        if (next.done) break;
        const event = next.value;
        if (!event.data) continue;
        const candidate = JSON.parse(event.data) as Rpc;
        if (candidate.id === id) { envelope = candidate; break; }
      }
      if (!stream) await iterator.return(undefined);
    } else {
      const text = await response.text();
      if (text.length > 2 * 1024 * 1024) throw new Error('MCP 响应超过 2 MB。');
      envelope = JSON.parse(text) as Rpc;
    }
    if (!envelope || envelope.jsonrpc !== '2.0' || envelope.id !== id || envelope.error || !envelope.result) throw new Error(`MCP ${method} 未返回有效结果。`);
    return envelope.result;
  }
  try {
    if (transport === 'sse') {
      const res = await fetch(url, { headers: { ...headers, Accept: 'text/event-stream' }, signal: controller.signal, redirect: 'error' });
      if (!res.ok || !res.body) throw new Error(`SSE 连接失败（HTTP ${res.status}）。`);
      stream = events(res.body, controller.signal);
      let endpointEvent: { event: string; data: string } | undefined;
      while (true) {
        const next = await stream.next();
        if (next.done) break;
        if (next.value.event === 'endpoint') { endpointEvent = next.value; break; }
        if (next.value.data) throw new Error('SSE 服务未返回有效消息端点，请检查协议和地址。');
      }
      if (!endpointEvent) throw new Error('SSE 服务未返回消息端点。');
      const target = new URL(endpointEvent.data, url);
      if (target.origin !== new URL(url).origin) throw new Error('SSE 消息端点必须与连接地址同源。');
      endpoint = target.toString();
    }
    const init = await rpc('initialize', { protocolVersion: version, capabilities: {}, clientInfo: { name: 'agentteams-dashboard', version: '1.4.1' } });
    if (typeof init.protocolVersion !== 'string' || !init.serverInfo) throw new Error('MCP 初始化信息不完整。');
    version = init.protocolVersion;
    const notification = await send({ jsonrpc: '2.0', method: 'notifications/initialized' });
    await notification.body?.cancel();
    return await action(rpc);
  } catch (error) {
    if (controller.signal.aborted) throw new Error(`MCP 验证超时（${timeout / 1000} 秒），新配置可能仍在网关生效中，请稍后重试。`);
    throw error;
  } finally {
    controller.abort(); clearTimeout(timer);
    await stream?.return(undefined).catch(() => undefined);
  }
}

export async function listMcpTools(rpc: (_method: string, _params?: Record<string, unknown>) => Promise<Record<string, unknown>>): Promise<McpToolSchema[]> {
  const tools: McpToolSchema[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 20; page++) {
    const result = await rpc('tools/list', cursor ? { cursor } : {});
    if (!Array.isArray(result.tools) || result.tools.some((tool) => !tool || typeof tool.name !== 'string' || !tool.inputSchema || typeof tool.inputSchema !== 'object')) throw new Error('MCP 工具列表格式不正确。');
    tools.push(...result.tools as McpToolSchema[]);
    if (typeof result.nextCursor !== 'string' || !result.nextCursor) return tools;
    if (result.nextCursor === cursor) throw new Error('MCP 工具分页游标重复。');
    cursor = result.nextCursor;
  }
  throw new Error('MCP 工具列表超过分页上限。');
}
