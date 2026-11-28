import type { TaskStatus } from '@/hooks/use-task-board';

export const TASK_STATUS: Record<TaskStatus, { label: string; color: string }> = {
  pending: { label: '待办', color: '#767D84' },
  assigned: { label: '已派发', color: '#527DA5' },
  in_progress: { label: '进行中', color: '#CB9300' },
  submitted: { label: '待验收', color: '#527DA5' },
  revision: { label: '需修订', color: '#94689B' },
  completed: { label: '已完成', color: '#00966A' },
  failed: { label: '失败', color: '#CA3D48' },
  cancelled: { label: '已取消', color: '#767D84' },
  blocked: { label: '阻塞', color: '#8B5535' },
  unknown: { label: '未知', color: '#9B9E9B' },
};

export function awaitsLeaderReview(status?: string, progress?: { total: number; completed: number }) {
  return (status === 'in_progress' || status === 'submitted') && !!progress && progress.total > 0 && progress.completed === progress.total;
}

export function taskStatus(status?: string, progress?: { total: number; completed: number }) {
  const aliases: Record<string, TaskStatus> = { running: 'in_progress', active: 'in_progress', success: 'completed', done: 'completed', error: 'failed', canceled: 'cancelled', waiting: 'pending' };
  const key = status && (aliases[status] ?? status);
  if (awaitsLeaderReview(key || undefined, progress)) {
    return { label: 'Leader 验收中', color: '#527DA5' };
  }
  return key && Object.hasOwn(TASK_STATUS, key) ? TASK_STATUS[key as TaskStatus] : TASK_STATUS.unknown;
}
