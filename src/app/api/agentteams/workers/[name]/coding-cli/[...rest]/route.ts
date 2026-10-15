import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';
import { isValidNameSegment } from '@/lib/skill-package';
import { isCodingCliId } from '@/lib/coding-cli-presets';

// B7 worker Coding CLI 白名单代理（#1360 消费）。
// 纪律（与 channels 同）：仅固定路径转发，禁通用反代。
//   GET  {cli}/settings
//   PUT  {cli}/settings          — RBAC update worker
//   POST {cli}/install           — RBAC update worker
//   GET  {cli}/install/{task_id}
// CLI 白名单：qwen-code、opencode、qoder。其余 rest 组合 400。

interface Endpoint {
  method: 'GET' | 'POST';
}

function resolveEndpoint(rest: string[]): Endpoint | null {
  if (rest.length < 2 || !isCodingCliId(rest[0])) return null;
  if (rest.length === 2 && rest[1] === 'settings') {
    return { method: 'GET' };
  }
  if (rest.length === 2 && rest[1] === 'install') {
    return { method: 'POST' };
  }
  if (rest.length === 3 && rest[1] === 'install') {
    return { method: 'GET' };
  }
  return null;
}

const seg = (s: string) => encodeURIComponent(s);

function pathFor(name: string, rest: string[]): string {
  return `/api/v1/workers/${seg(name)}/coding-cli/${rest.map(seg).join('/')}`;
}

function isValidTaskId(s: string): boolean {
  return (
    s !== '.' &&
    s !== '..' &&
    s.length > 0 &&
    s.length <= 128 &&
    /^[A-Za-z0-9._:+%=-]+$/.test(s)
  );
}

async function parseNameRest(
  params: Promise<{ name: string; rest: string[] }>,
): Promise<{ name: string; rest: string[] } | NextResponse> {
  const { name, rest = [] } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }
  for (let i = 0; i < rest.length; i++) {
    const allowTaskId = i === 2 && rest[1] === 'install';
    const ok = allowTaskId ? isValidTaskId(rest[i]) : isValidNameSegment(rest[i]);
    if (!ok) {
      return NextResponse.json({ error: allowTaskId ? '非法任务 ID' : '非法路径段' }, { status: 400 });
    }
  }
  return { name, rest };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; rest: string[] }> },
) {
  const parsed = await parseNameRest(params);
  if (parsed instanceof NextResponse) return parsed;
  const { name, rest } = parsed;
  const ep = resolveEndpoint(rest);
  if (!ep || ep.method !== 'GET') {
    return NextResponse.json({ error: '不支持的端点' }, { status: 400 });
  }
  const controllerUrl = getControllerUrl(request);
  return proxyToAgentTeams(request, controllerUrl, pathFor(name, rest), {
    forwardBody: false,
    method: 'GET',
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; rest: string[] }> },
) {
  const parsed = await parseNameRest(params);
  if (parsed instanceof NextResponse) return parsed;
  const { name, rest } = parsed;
  if (rest.length !== 2 || rest[1] !== 'settings' || !isCodingCliId(rest[0])) {
    return NextResponse.json({ error: '不支持的端点' }, { status: 400 });
  }
  const denied = await enforceServerSideRbac(request, 'update', 'worker', name);
  if (denied) return denied;
  const controllerUrl = getControllerUrl(request);
  return proxyToAgentTeams(request, controllerUrl, pathFor(name, rest), {
    forwardBody: true,
    method: 'PUT',
  });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ name: string; rest: string[] }> },
) {
  const parsed = await parseNameRest(params);
  if (parsed instanceof NextResponse) return parsed;
  const { name, rest } = parsed;
  const ep = resolveEndpoint(rest);
  if (!ep || ep.method !== 'POST') {
    return NextResponse.json({ error: '不支持的端点' }, { status: 400 });
  }
  const denied = await enforceServerSideRbac(request, 'update', 'worker', name);
  if (denied) return denied;
  const controllerUrl = getControllerUrl(request);
  return proxyToAgentTeams(request, controllerUrl, pathFor(name, rest), {
    forwardBody: true,
    method: 'POST',
  });
}
