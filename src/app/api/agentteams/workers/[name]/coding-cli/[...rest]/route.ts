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
// CLI 白名单：qwen-code、opencode。其余 rest 组合 400。

interface Endpoint {
  method: 'GET' | 'PUT' | 'POST';
  forwardBody: boolean;
  mutates: boolean;
}

function resolveEndpoint(rest: string[]): Endpoint | null {
  if (rest.length < 2 || !isCodingCliId(rest[0])) return null;
  if (rest.length === 2 && rest[1] === 'settings') {
    return { method: 'GET', forwardBody: false, mutates: false };
  }
  if (rest.length === 2 && rest[1] === 'install') {
    return { method: 'POST', forwardBody: true, mutates: true };
  }
  if (rest.length === 3 && rest[1] === 'install') {
    return { method: 'GET', forwardBody: false, mutates: false };
  }
  return null;
}

const seg = (s: string) => encodeURIComponent(s);

function pathFor(name: string, rest: string[]): string {
  return `/api/v1/workers/${seg(name)}/coding-cli/${rest.map(seg).join('/')}`;
}

async function parseNameRest(
  params: Promise<{ name: string; rest: string[] }>,
): Promise<{ name: string; rest: string[] } | NextResponse> {
  const { name, rest = [] } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }
  for (const s of rest) {
    if (!isValidNameSegment(s)) {
      return NextResponse.json({ error: '非法路径段' }, { status: 400 });
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
