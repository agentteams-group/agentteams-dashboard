/**
 * 六个语义状态 token 的名字表（方案 v3 A-1）。
 *
 * 单独成文件是因为 Next 的限制：任何被 React Server Component import 的模块都不
 * 准带 hooks（`useEffect` 之类），而解算真色的 `useStatusColors()` 必须用 hook。
 * 所以名字与归类关系放这里（纯数据，两边都能引），解算放 `@/hooks/use-status-colors`。
 *
 * 值本身只在 `src/app/globals.css` 的 :root、.dark、.high-contrast 各定义一次。
 */
export const STATUS_TOKENS = ['running', 'waiting', 'blocked', 'done', 'failed', 'info'] as const;

export type StatusToken = (typeof STATUS_TOKENS)[number];

/** 徽章用类：底 = token 色 15% 淡染，文本 = token 本色，边 = 30%。 */
export function statusBadgeClass(token: StatusToken): string {
  return `bg-status-${token}/15 text-status-${token} border-status-${token}/30`;
}

/**
 * 只取文本色的类：状态圆点旁边的阶段名、图标这类不带底色的位置用，
 * 免得调用点又自己抄一遍 `text-emerald-500`（方案 v3 A-2 收掉的正是这种）。
 */
export function statusTextClass(token: StatusToken): string {
  return `text-status-${token}`;
}

/** 只取底色的类：状态圆点、进度条一类的实心小块。 */
export function statusDotClass(token: StatusToken): string {
  return `bg-status-${token}`;
}

/** 阶段名 → 语义 token。图表、状态点和徽章都用这张表归色，不再各自记色号。 */
export const PHASE_STATUS_TOKEN: Record<string, StatusToken> = {
  Running: 'running',
  Ready: 'done',
  Sleeping: 'info',
  Updating: 'info',
  Pending: 'waiting',
  Stopped: 'blocked',
  Failed: 'failed',
  // 团队 / Manager / Human 的阶段名与 worker 不同名，一并收进同一张表。
  Active: 'running',
  Degraded: 'blocked',
};
