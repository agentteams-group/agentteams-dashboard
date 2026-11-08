import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../proxy-helper';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';

export const dynamic = 'force-dynamic';

// /api/agentteams/millforge/{...path}
//
// 千锻（Millforge）编译/注入域的固定路径白名单转发（禁通用反代）：
// source（GET/PUT）、import、packs、packs/{pack}/file、compile、
// inject、inject/preflight、rollback、prompt、parse-team-json、injections。
// 契约 = agentteams_connector/millforge_api.py（工作台插件同一后端），
// Controller 只做凭据/权限边界；本层原样转发服务端凭据与上游错误体。
// 旧 Controller 无这些路由 → 404/405 原样回前端，四 tab 各自降级。
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

async function forward(request: NextRequest, rest: string[], method: string) {
  const rule = resolveRule(method, rest);
  if (!rule) {
    return NextResponse.json({ error: '不支持的千锻端点' }, { status: 400 });
  }
  if (rest.length >= 2 && rest[0] === 'packs' && !PACK_RE.test(rest[1])) {
    return NextResponse.json({ error: '非法模板包名' }, { status: 400 });
  }
  const path = `/api/v1/millforge/${rest.map(encodeURIComponent).join('/')}${forwardQuery(request)}`;
  if (rule.mutates) {
    const denied = await enforceLevelOnlyRbac(request, 'update', 'millforge', rest.join('/'));
    if (denied) return denied;
  }
  return proxyToAgentTeams(request, getControllerUrl(request), path, {
    method,
    forwardBody: rule.forwardBody,
    timeoutMs: rule.timeoutMs,
  });
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
