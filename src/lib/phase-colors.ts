// Shared Phase Colors & Labels for AgentTeams Dashboard
// Used by overview charts, worker/team/manager sections, and status dots

// ============ Hex Colors (for charts / Recharts) ============

export const WORKER_PHASE_COLORS: Record<string, string> = {
  Running: '#10b981',
  Ready: '#22c55e',
  Sleeping: '#3b82f6',
  Failed: '#ef4444',
  Pending: '#f59e0b',
  Stopped: '#6b7280',
  Updating: '#8b5cf6',
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
};

// ============ Tailwind Badge Classes (for Badge components) ============

export const WORKER_PHASE_BADGE_CLASSES: Record<string, string> = {
  Pending: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  Running: 'bg-green-500/10 text-green-600 dark:text-green-400',
  Sleeping: 'bg-blue-500/10 text-blue-600 dark:text-blue-400',
  Updating: 'bg-purple-500/10 text-purple-600 dark:text-purple-400',
  Stopped: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  Failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
  Ready: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
};

export const TEAM_PHASE_BADGE_CLASSES: Record<string, string> = {
  Pending: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  Active: 'bg-green-500/10 text-green-600 dark:text-green-400',
  Degraded: 'bg-orange-500/10 text-orange-600 dark:text-orange-400',
  Failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

export const MANAGER_PHASE_BADGE_CLASSES: Record<string, string> = {
  Running: 'bg-green-500/10 text-green-600 dark:text-green-400',
  Pending: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  Failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

export const HUMAN_PHASE_BADGE_CLASSES: Record<string, string> = {
  Pending: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400',
  Active: 'bg-green-500/10 text-green-600 dark:text-green-400',
  Failed: 'bg-red-500/10 text-red-600 dark:text-red-400',
};

// ============ Badge Variant Helper ============


