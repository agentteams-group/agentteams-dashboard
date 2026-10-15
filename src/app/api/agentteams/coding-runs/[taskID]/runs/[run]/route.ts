import { NextRequest, NextResponse } from 'next/server';
import { getControllerUrl, proxyToAgentTeams } from '../../../../proxy-helper';

// 编码执行记录详情（#146 缺口 2，只读）：GET 透传上游
// `GET /api/v1/coding-runs/{taskID}/runs/{run}`。上游以 text/plain 字节透传原始
// 运行日志（run-YYYYMMDD-HHMMSS.log）。taskID 与 run 文件名在本地校验（防路径
// 穿越）；`team` 查询参数原样转发（上游据此限定团队前缀）。只读，无审计。

// 与上游 isSafeTaskID 对齐：首字符字母数字，其余字母数字 / `.` / `_` / `-`。
const TASK_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
const RUN_FILE = /^run-\d{8}-\d{6}\.log$/;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ taskID: string; run: string }> },
) {
  const { taskID, run } = await params;
  if (taskID.length > 128 || !TASK_ID.test(taskID)) {
    return NextResponse.json({ error: '非法任务 ID' }, { status: 400 });
  }
  if (!RUN_FILE.test(run)) {
    return NextResponse.json({ error: '非法执行记录 ID' }, { status: 400 });
  }
  const controllerUrl = getControllerUrl(request);
  const team = request.nextUrl.searchParams.get('team');
  const search = team ? `?team=${encodeURIComponent(team)}` : '';
  const path = `/api/v1/coding-runs/${encodeURIComponent(taskID)}/runs/${encodeURIComponent(run)}${search}`;
  return proxyToAgentTeams(request, controllerUrl, path, {
    forwardBody: false,
    method: 'GET',
  });
}
