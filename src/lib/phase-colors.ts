// Shared Phase Colors & Labels for AgentTeams Dashboard
// Used by overview charts, worker/team/manager sections, and status dots
//
// 颜色单轨（方案 v3 A-2）：本文件不再自带一套调色盘，全部引用 A-1 的
// 六个语义状态 token（--status-running/-waiting/-blocked/-done/-failed/-info）。
// 以前 worker 徽章用 green/yellow、项目徽章用 emerald/amber、我的工作台内联写
// text-sky-500，同一个「等待」在三个地方是三种颜色，高对比主题下也各自不同。

// ============ Chart / canvas colors (CSS vars, resolved per theme) ============

/**
 * 给图表用的颜色。值是 CSS 变量引用：写在 `style` 里直接生效，
 * 要真色的地方（Recharts 的 `fill` 属性、canvas）用 `useStatusColors()` 解算。
 */
export const WORKER_PHASE_COLORS: Record<string, string> = {
  Running: 'var(--status-running)',
  Ready: 'var(--status-done)',
  Sleeping: 'var(--status-info)',
  Failed: 'var(--status-failed)',
  Pending: 'var(--status-waiting)',
  Stopped: 'var(--status-blocked)',
  Updating: 'var(--status-info)',
};


// ============ Chinese Labels ============

export const WORKER_PHASE_LABELS: Record<string, string> = {
  Running: '运行中',
  Ready: '就绪',
  Sleeping: '休眠中',
  Failed: '失败',
  Pending: '等待中',
  Stopped: '已停止',
  Updating: '更新中',
};

export const TEAM_PHASE_LABELS: Record<string, string> = {
  Pending: '等待中',
  Active: '活跃',
  Degraded: '降级',
  Failed: '失败',
};

export const MANAGER_PHASE_LABELS: Record<string, string> = {
  Running: '运行中',
  Pending: '等待中',
  Failed: '失败',
};

export const HUMAN_PHASE_LABELS: Record<string, string> = {
  Pending: '等待中',
  Active: '活跃',
  Failed: '失败',
};

export const RUNTIME_LABELS: Record<string, string> = {
  openclaw: 'OpenClaw',
  copaw: 'CoPaw',
  hermes: 'Hermes',
  openhuman: 'OpenHuman',
  qwenpaw: 'QwenPaw',
  'deepseek-harness': 'DeepSeek Harness',
};

// ============ Tailwind Badge Classes (for Badge components) ============
// 只允许可读的六个语义 token；新增阶段时先在 phase-badge 里把阶段名归到
// 其中一个语义上，不要在这里新开一个颜色。

export const WORKER_PHASE_BADGE_CLASSES: Record<string, string> = {
  Pending: 'bg-status-waiting/15 text-status-waiting border-status-waiting/30',
  Running: 'bg-status-running/15 text-status-running border-status-running/30',
  Sleeping: 'bg-status-info/15 text-status-info border-status-info/30',
  Updating: 'bg-status-info/15 text-status-info border-status-info/30',
  Stopped: 'bg-status-blocked/15 text-status-blocked border-status-blocked/30',
  Failed: 'bg-status-failed/15 text-status-failed border-status-failed/30',
  Ready: 'bg-status-done/15 text-status-done border-status-done/30',
};

export const TEAM_PHASE_BADGE_CLASSES: Record<string, string> = {
  Pending: 'bg-status-waiting/15 text-status-waiting border-status-waiting/30',
  Active: 'bg-status-running/15 text-status-running border-status-running/30',
  Degraded: 'bg-status-blocked/15 text-status-blocked border-status-blocked/30',
  Failed: 'bg-status-failed/15 text-status-failed border-status-failed/30',
};

export const MANAGER_PHASE_BADGE_CLASSES: Record<string, string> = {
  Running: 'bg-status-running/15 text-status-running border-status-running/30',
  Pending: 'bg-status-waiting/15 text-status-waiting border-status-waiting/30',
  Failed: 'bg-status-failed/15 text-status-failed border-status-failed/30',
};

export const HUMAN_PHASE_BADGE_CLASSES: Record<string, string> = {
  Pending: 'bg-status-waiting/15 text-status-waiting border-status-waiting/30',
  Active: 'bg-status-running/15 text-status-running border-status-running/30',
  Failed: 'bg-status-failed/15 text-status-failed border-status-failed/30',
};

// ============ Badge Variant Helper ============


