import { NextRequest, NextResponse } from 'next/server';
import { getAuthToken, getControllerUrl } from '../../../proxy-helper';
import { enforceLevelOnlyRbac } from '@/lib/server-auth';
import { isValidNameSegment } from '@/lib/skill-package';
import { clampLogTail, managerContainerName, parseManagerLogText } from '@/lib/manager-logs';
import { demuxDockerStream } from '../../../debug-log/docker';

// GET /api/agentteams/managers/{name}/logs?tail=300
//
// Manager 容器日志：Controller 没有 manager 日志路由，只有 Docker API 透传面
// （同 logs/[component] 与 wen-tian/logs 的做法）。容器名按 Controller 的
// ResourcePrefix.ManagerPodName 口径推导（default → agentteams-manager）。
//
// 门：host/Docker 级读取属 admin-adjacent（'manage'，L3-only）——与
// logs/[component] 的 SEC-07 判定一致。404（容器不存在）/403 原样透传，其余
// 上游异常折成 502（卡内「加载失败 · 重试」）。

export const dynamic = 'force-dynamic';

const DOCKER_API_VERSION = 'v1.41';
const DOCKER_TIMEOUT_MS = 10000;


export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  if (!isValidNameSegment(name)) {
    return NextResponse.json({ error: '非法 Manager 名' }, { status: 400 });
  }

  const denied = await enforceLevelOnlyRbac(request, 'manage', 'container-log', name);
  if (denied) return denied;

  const tail = clampLogTail(request.nextUrl.searchParams.get('tail'));
  const container = managerContainerName(name);

  try {
    const token = await getAuthToken();
    const target = new URL(
      `/docker/${DOCKER_API_VERSION}/containers/${encodeURIComponent(container)}/logs` +
        `?stdout=1&stderr=1&timestamps=1&tail=${tail}`,
      getControllerUrl(request),
    ).toString();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), DOCKER_TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(target, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      // 404 = 容器不存在（Manager 未起容器/已删除）；403 = 无权；两者让前端
      // 分别落到「无日志源」「无权限」可读态。
      const status = res.status === 404 || res.status === 403 ? res.status : 502;
      return NextResponse.json(
        { error: `Docker API ${res.status}: ${text.slice(0, 500)}` },
        { status },
      );
    }

    const text = demuxDockerStream(await res.arrayBuffer());
    return NextResponse.json(parseManagerLogText(text, name));
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown log error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
