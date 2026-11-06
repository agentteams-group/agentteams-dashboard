import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../proxy-helper';
import { enforceServerSideRbac } from '@/lib/server-auth';
import { isValidNameSegment } from '@/lib/skill-package';

// B5 worker runtime-config（#1231 消费，spec=方案与设计/.../PR/worker-runtime-config/scope.md）：
// GET/PUT 透传，状态码原样回传（proxy-helper 既有语义）——
// - PUT body = 仅改动字段（字段级合并在 Controller 侧完成，未改字段含 loop_config 原样往返）
// - 旧 Controller 版本（未含 #1231 端点）→ 404 透传 → 前端占位横幅（中性文案，不裸露上游 PR 号）
// - 409（per-file path lock）透传 status+body → 前端提示稍后重试
// - 审计由 proxyToAgentTeams 统一挂接（action=runtime-config，entity=worker）

const pathFor = (name: string) => `/api/v1/workers/${encodeURIComponent(name)}/runtime-config`;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }
  const controllerUrl = getControllerUrl(request);
  return proxyToAgentTeams(request, controllerUrl, pathFor(name), {
    forwardBody: false,
    method: 'GET',
    passthroughHeaders: ['etag'],
  });
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Worker 名' }, { status: 400 });
  }
  const denied = await enforceServerSideRbac(request, 'update', 'worker', name);
  if (denied) return denied;
  const controllerUrl = getControllerUrl(request);
  return proxyToAgentTeams(request, controllerUrl, pathFor(name), {
    forwardBody: true,
    method: 'PUT',
    ifMatch: request.headers.get('If-Match'),
    passthroughHeaders: ['etag'],
  });
}
