// Manager 容器日志的纯函数：容器名推导 / 尾行数钳制 / 行格式化 / 错误分类。
// 无 React / window 依赖，node 环境直测。
//
// 端点 = GET /api/agentteams/managers/{name}/logs?tail=300（Dashboard 代理
// Controller 的 Docker API `/docker/v1.41/containers/{container}/logs`）——
// Controller 自身没有 manager 日志路由，只有 docker API 透传面。

import { ApiError } from '@/lib/api-error';

/** 详情抽屉固定的尾行数（插件 ManagerLogsCard 同档）。 */
export const MANAGER_LOG_TAIL = 300;
/** 服务端可接受的最大尾行数。 */
export const MANAGER_LOG_TAIL_MAX = 2000;

/**
 * Manager CR 名 → 容器名（对齐 controller `auth.ResourcePrefix.ManagerPodName`）：
 * `default` 用共享的 `agentteams-manager`（install 脚本/CMS 服务名兼容），其余
 * 用 `agentteams-manager-<name>`。前缀固定 `agentteams-`（Dashboard 现有
 * logs/[component] 白名单同口径——前端不感知自定义 AGENTTEAMS_RESOURCE_PREFIX）。
 */
export function managerContainerName(name: string): string {
  const trimmed = name.trim();
  return trimmed === 'default' ? 'agentteams-manager' : `agentteams-manager-${trimmed}`;
}

/** 尾行数钳制：缺省/非法 → 300，上限 2000。 */
export function clampLogTail(raw: string | number | null | undefined): number {
  const parsed = typeof raw === 'number' ? raw : Number.parseInt(String(raw ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return MANAGER_LOG_TAIL;
  return Math.min(Math.floor(parsed), MANAGER_LOG_TAIL_MAX);
}

/** 展示行（`timestamp message`；error 级别加 ❌）。空消息行丢弃，不臆造。 */
export function formatManagerLogLines(
  lines: Array<{ timestamp?: string; level?: string; message?: string }> | null | undefined,
): string[] {
  if (!Array.isArray(lines)) return [];
  const out: string[] = [];
  for (const line of lines) {
    if (!line || typeof line !== 'object') continue;
    const timestamp = typeof line.timestamp === 'string' ? line.timestamp : '';
    const marker = line.level === 'error' ? '❌ ' : '';
    const message = typeof line.message === 'string' ? line.message : '';
    const text = `${timestamp} ${marker}${message}`.trim();
    if (text) out.push(text);
  }
  return out;
}

const TIMESTAMPED_LINE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)\s(.*)$/;

/** Docker 原始日志文本 → LogLine[]（timestamps=1 → 每行 `<ts> <msg>`）。 */
export function parseManagerLogText(
  text: string,
  component: string,
): Array<{ timestamp: string; level: string; component: string; message: string }> {
  const lines: Array<{ timestamp: string; level: string; component: string; message: string }> = [];
  for (const raw of text.split('\n')) {
    if (!raw.trim()) continue;
    const match = raw.match(TIMESTAMPED_LINE);
    if (match) {
      lines.push({ timestamp: match[1], level: 'info', component, message: match[2].trimEnd() });
      continue;
    }
    lines.push({ timestamp: '', level: 'info', component, message: raw.trimEnd() });
  }
  return lines;
}

/** 日志读取失败的可读分类：404/405 = 端点或容器不存在，403 = 无权，其余可重试。 */
export type ManagerLogErrorKind = 'missing' | 'forbidden' | 'error';

export function classifyManagerLogError(err: unknown): ManagerLogErrorKind {
  if (err instanceof ApiError) {
    if (err.status === 404 || err.status === 405) return 'missing';
    if (err.status === 403) return 'forbidden';
  }
  return 'error';
}
