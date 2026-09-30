import { NextRequest, NextResponse } from 'next/server';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';

interface McpTestRequestBody {
  url?: unknown;
  transport?: unknown;
  headers?: unknown;
  timeout?: unknown;
}

interface McpTestResult {
  success: boolean;
  message: string;
  statusCode?: number;
  latencyMs?: number;
}

const MCP_PROTOCOL_VERSION = '2025-03-26';
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_TIMEOUT_MS = 30_000;
const MAX_HEADER_COUNT = 32;
const MAX_HEADER_VALUE_LENGTH = 4_096;

function jsonResult(result: McpTestResult, status = 200): NextResponse {
  return NextResponse.json(result, { status });
}

/**
 * Parse a single MCP JSON-RPC payload (`initialize` response). Returns
 * `{ ok: false }` without detail when the text is not a JSON-RPC envelope,
 * so SSE frame scanning can keep looking at later frames.
 */
function parseJsonRpcPayload(raw: string): { ok: boolean; detail?: string } {
  const trimmed = raw.trim();
  if (!trimmed.startsWith('{')) return { ok: false };
  try {
    const parsed = JSON.parse(trimmed) as {
      result?: { protocolVersion?: string; serverInfo?: { name?: string } };
      error?: { message?: string };
    };
    if (parsed.error) {
      return { ok: false, detail: `MCP 错误: ${parsed.error.message ?? '未知错误'}` };
    }
    if (parsed.result) {
      const server = parsed.result.serverInfo?.name;
      const version = parsed.result.protocolVersion;
      const detail = server
        ? `${server}${version ? ` (协议 ${version})` : ''}`
        : version
          ? `协议 ${version}`
          : undefined;
      return { ok: true, detail };
    }
    return { ok: false, detail: '响应缺少 result 字段' };
  } catch {
    return { ok: false, detail: 'JSON 解析失败' };
  }
}

/**
 * Parse an MCP JSON-RPC response. Streamable HTTP servers may answer the
 * initialize POST with either `application/json` or an SSE stream
 * (`text/event-stream`); in the latter case the first `data:` frame carries
 * the JSON-RPC response.
 */
function parseMcpResponse(raw: string): { ok: boolean; detail?: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: false, detail: '空响应' };
  if (trimmed.startsWith('{')) return parseJsonRpcPayload(trimmed);

  // SSE stream: scan data: frames for the first JSON-RPC payload.
  for (const line of trimmed.split('\n')) {
    if (!line.startsWith('data:')) continue;
    const frame = line.slice(5).trim();
    if (!frame || frame === '[DONE]') continue;
    const parsed = parseJsonRpcPayload(frame);
    if (parsed.ok || parsed.detail) return parsed;
  }
  return { ok: false, detail: 'SSE 流中未找到 JSON-RPC 响应' };
}

function sanitizeHeaders(input: unknown): Record<string, string> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return {};
  const entries = Object.entries(input as Record<string, unknown>)
    .filter(([key, value]) => typeof key === 'string' && typeof value === 'string')
    .slice(0, MAX_HEADER_COUNT)
    .map(([key, value]) => [key, (value as string).slice(0, MAX_HEADER_VALUE_LENGTH)] as const);
  return Object.fromEntries(entries);
}

function describeHttpFailure(status: number, transport: string): string {
  if (status === 401 || status === 403) {
    return `鉴权失败 (${status})：请检查登记配置中的 Authorization 等请求头`;
  }
  if (status === 404) {
    return '端点不存在 (404)：请检查 MCP Server 地址路径';
  }
  if (status === 405) {
    return `方法不被允许 (405)：端点不接受 ${transport === 'sse' ? 'GET' : 'POST'} 握手，请检查 transport 类型（sse / streaminghttp）`;
  }
  return `连接失败 (${status})`;
}

/**
 * POST /api/agentteams/mcps/test — MCP Server connectivity probe.
 *
 * Performs a real MCP `initialize` handshake (streamable HTTP: single POST;
 * legacy SSE: open the GET event stream). Auth headers registered with the
 * server are forwarded, so proxies that require Authorization are testable.
 */
export async function POST(request: NextRequest) {
  const denied = await enforceLevelOnlyRbac(request, 'view', 'mcp', 'test');
  if (denied) return denied;

  let body: McpTestRequestBody;
  try {
    body = (await request.json()) as McpTestRequestBody;
  } catch {
    return jsonResult({ success: false, message: '请求体不是合法 JSON' }, 400);
  }

  const url = typeof body.url === 'string' ? body.url.trim() : '';
  if (!url || !/^https?:\/\//i.test(url)) {
    return jsonResult({ success: false, message: 'MCP Server 地址不合法（需以 http:// 或 https:// 开头）' }, 400);
  }

  const transport = body.transport === 'sse' ? 'sse' : 'streaminghttp';
  const headers = sanitizeHeaders(body.headers);
  const timeoutMs =
    typeof body.timeout === 'number' && Number.isFinite(body.timeout) && body.timeout > 0
      ? Math.min(Math.round(body.timeout), MAX_TIMEOUT_MS)
      : DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const startedAt = Date.now();

  try {
    if (transport === 'sse') {
      // Legacy SSE transport: the server keeps a GET event stream open.
      const streamResponse = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'text/event-stream', ...headers },
        signal: controller.signal,
      });
      if (!streamResponse.ok || !streamResponse.body) {
        return jsonResult({
          success: false,
          message: describeHttpFailure(streamResponse.status, transport),
          statusCode: streamResponse.status,
          latencyMs: Date.now() - startedAt,
        });
      }
      const reader = streamResponse.body.getReader();
      const { value } = await reader.read();
      reader.cancel().catch(() => undefined);
      const chunk = value ? new TextDecoder().decode(value) : '';
      const parsed = parseMcpResponse(chunk);
      return jsonResult({
        success: parsed.ok,
        message: parsed.ok
          ? `SSE 通道已打开${parsed.detail ? `: ${parsed.detail}` : ''}`
          : `SSE 通道打开但握手异常: ${parsed.detail ?? '未知错误'}`,
        statusCode: streamResponse.status,
        latencyMs: Date.now() - startedAt,
      });
    }

    // Streamable HTTP: initialize is a single POST returning JSON or SSE.
    const initPayload = JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: MCP_PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: { name: 'agentteams-dashboard', version: '1.2.5' },
      },
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json, text/event-stream',
        ...headers,
      },
      body: initPayload,
      signal: controller.signal,
    });

    const latencyMs = Date.now() - startedAt;
    if (!response.ok) {
      return jsonResult({
        success: false,
        message: describeHttpFailure(response.status, transport),
        statusCode: response.status,
        latencyMs,
      });
    }

    const raw = await response.text();
    const parsed = parseMcpResponse(raw);
    if (!parsed.ok) {
      return jsonResult({
        success: false,
        message: `连接成功但 MCP 握手失败: ${parsed.detail ?? '未知错误'}`,
        statusCode: response.status,
        latencyMs,
      });
    }
    return jsonResult({
      success: true,
      message: `连接成功${parsed.detail ? `: ${parsed.detail}` : ''}`,
      statusCode: response.status,
      latencyMs,
    });
  } catch (error) {
    const latencyMs = Date.now() - startedAt;
    if (error instanceof Error && error.name === 'AbortError') {
      return jsonResult({ success: false, message: `连接超时（${timeoutMs}ms）`, latencyMs });
    }
    const reason = error instanceof Error && error.message ? error.message : '未知网络错误';
    return jsonResult({ success: false, message: `无法连接: ${reason}`, latencyMs });
  } finally {
    clearTimeout(timer);
  }
}
