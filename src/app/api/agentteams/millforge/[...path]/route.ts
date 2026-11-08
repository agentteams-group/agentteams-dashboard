import { NextRequest, NextResponse } from 'next/server';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

// /api/agentteams/millforge/{...path}
//
// 千锻（Millforge）编译/注入域的固定路径白名单转发（禁通用反代）：
// source（GET/PUT）、import、packs、packs/{pack}/file、compile、
// inject、inject/preflight、rollback、prompt、parse-team-json、injections。
//
// 后端归属（2026-11-08 修正 dashboard 404/405）：
// - 编译/注入核心域**不在 Controller**，只存在于工作台插件 connector
//   （agentteams_connector/millforge_api.py，挂在 QwenPaw host 的
//   /api/agentteams-proxy/millforge/*）→ 本层按 AGENTTEAMS_MILLFORGE_URL
//   转发到 `<connector>/api/agentteams-proxy/millforge/{rest}`。
// - 模块更新面（millforge/index、teams/{team}/modules、install）仍是
//   Controller 路由，走各自 route 文件，不经过本层。
// connector 不可达 → 503（不伪装 404/405）；上游 404/405 原样给 UI。
//
// 读端点保持短超时；import/compile/inject 是长作业（clone 90s、编译器
// 120s、逐 Worker 注入），按插件前端同量级放宽上游超时。
// 写端点（source PUT / import / inject / rollback）先过服务端等级门
// （update = L1），与团队模块安装的纵深防御一致。

interface Rule {
  forwardBody: boolean;
  timeoutMs?: number;
  /** 写操作（source PUT / import / inject / rollback）。 */
  mutates?: boolean;
}

const READ_TIMEOUT_MS = 30_000;
const LONG_TIMEOUT_MS = 300_000;
const COMPILE_TIMEOUT_MS = 180_000;
const ACTION_TIMEOUT_MS = 60_000;

/** 工作台插件 connector 默认地址（docker 侧经 host-gateway 到宿主 QwenPaw）。 */
const DEFAULT_CONNECTOR_URL = 'http://host.docker.internal:8088';
/** connector 侧的服务端身份，供插件审计归属（不转发任何凭据）。 */
const IDENTITY_HEADERS = ['x-agentteams-user', 'x-agentteams-user-level'];

/** connector 基址：env 优先，末尾斜杠归一。 */
function getConnectorUrl(): string {
  const configured = process.env.AGENTTEAMS_MILLFORGE_URL?.trim();
  return (configured || DEFAULT_CONNECTOR_URL).replace(/\/+$/, '');
}

/** rest 段 → 端点规则；未列入的组合一律 400。 */
function resolveRule(method: string, rest: string[]): Rule | null {
  if (rest.length === 0) return null;
  const [head, second, third] = rest;
  if (rest.length === 1) {
    if (head === 'source') {
      if (method === 'GET') return { forwardBody: false, timeoutMs: READ_TIMEOUT_MS };
      if (method === 'PUT') return { forwardBody: true, timeoutMs: READ_TIMEOUT_MS, mutates: true };
      return null;
    }
    if (head === 'packs' && method === 'GET') return { forwardBody: false, timeoutMs: READ_TIMEOUT_MS };
    if (head === 'injections' && method === 'GET') return { forwardBody: false, timeoutMs: READ_TIMEOUT_MS };
    if (head === 'import' && method === 'POST') return { forwardBody: true, timeoutMs: LONG_TIMEOUT_MS, mutates: true };
    if (head === 'compile' && method === 'POST') return { forwardBody: true, timeoutMs: COMPILE_TIMEOUT_MS };
    if (head === 'inject' && method === 'POST') return { forwardBody: true, timeoutMs: LONG_TIMEOUT_MS, mutates: true };
    if (head === 'rollback' && method === 'POST') return { forwardBody: true, timeoutMs: ACTION_TIMEOUT_MS, mutates: true };
    if (head === 'prompt' && method === 'POST') return { forwardBody: true, timeoutMs: ACTION_TIMEOUT_MS };
    if (head === 'parse-team-json' && method === 'POST') return { forwardBody: true, timeoutMs: ACTION_TIMEOUT_MS };
    return null;
  }
  if (rest.length === 2 && head === 'inject' && second === 'preflight' && method === 'POST') {
    return { forwardBody: true, timeoutMs: ACTION_TIMEOUT_MS };
  }
  if (rest.length === 3 && head === 'packs' && third === 'file' && method === 'GET') {
    return { forwardBody: false, timeoutMs: READ_TIMEOUT_MS };
  }
  return null;
}

/** pack 名 = 仓库 slug；其余段只允许字面量白名单（禁路径穿越）。 */
const PACK_RE = /^(?!\.+$)[A-Za-z0-9._-]+$/;

function forwardQuery(request: NextRequest): string {
  const forwarded = new URLSearchParams();
  for (const [key, value] of request.nextUrl.searchParams.entries()) {
    if (key === 'controllerUrl') continue; // internal override, not proxied
    forwarded.append(key, value);
  }
  const qs = forwarded.toString();
  return qs ? `?${qs}` : '';
}

async function forwardToConnector(
  request: NextRequest,
  rest: string[],
  method: string,
  rule: Rule,
) {
  const timeoutMs = rule.timeoutMs ?? READ_TIMEOUT_MS;
  const url = new URL(
    `/api/agentteams-proxy/millforge/${rest.map(encodeURIComponent).join('/')}${forwardQuery(request)}`,
    getConnectorUrl(),
  );

  const headers: Record<string, string> = {};
  let body: string | undefined;
  if (rule.forwardBody && ['POST', 'PUT', 'PATCH'].includes(method)) {
    try {
      body = await request.text();
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to read request body';
      return NextResponse.json({ error: message }, { status: 502 });
    }
    headers['content-type'] = 'application/json';
  }
  for (const name of IDENTITY_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url.toString(), {
      method,
      headers,
      body,
      signal: controller.signal,
      cache: 'no-store',
    });
    clearTimeout(timer);
    // 上游 404/405 等错误状态原样给 UI（面板各自降级），不在这里改写。
    if (res.status === 204) return new NextResponse(null, { status: 204 });
    const data = await res.arrayBuffer();
    const responseHeaders = new Headers();
    const contentType = res.headers.get('content-type');
    if (contentType) responseHeaders.set('content-type', contentType);
    responseHeaders.set('cache-control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    responseHeaders.set('pragma', 'no-cache');
    responseHeaders.set('expires', '0');
    return new NextResponse(data, { status: res.status, headers: responseHeaders });
  } catch (err: unknown) {
    clearTimeout(timer);
    const detail =
      err instanceof Error && err.name === 'AbortError'
        ? `timeout after ${timeoutMs}ms`
        : err instanceof Error
          ? err.message
          : 'unknown error';
    console.error(
      '[dashboard] millforge connector unreachable',
      JSON.stringify({ url: url.toString(), method, detail }),
    );
    return NextResponse.json(
      {
        error: '工作台插件 connector 不可达（AGENTTEAMS_MILLFORGE_URL）',
        detail,
      },
      { status: 503 },
    );
  }
}

async function forward(request: NextRequest, rest: string[], method: string) {
  const rule = resolveRule(method, rest);
  if (!rule) {
    return NextResponse.json({ error: '不支持的千锻端点' }, { status: 400 });
  }
  if (rest.length >= 2 && rest[0] === 'packs' && !PACK_RE.test(rest[1])) {
    return NextResponse.json({ error: '非法模板包名' }, { status: 400 });
  }
  if (rule.mutates) {
    const denied = await enforceLevelOnlyRbac(request, 'update', 'millforge', rest.join('/'));
    if (denied) return denied;
  }
  return forwardToConnector(request, rest, method, rule);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path = [] } = await params;
  return forward(request, path, 'GET');
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path = [] } = await params;
  return forward(request, path, 'PUT');
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
) {
  const { path = [] } = await params;
  return forward(request, path, 'POST');
}
