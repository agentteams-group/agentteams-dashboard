'use client';

import type { WorkerSessionState } from '@/lib/worker-session-state';

// 8px session dot (A17). Palette (9/14 design freeze):
//   blue #3b82f6 = running (breathing, 1.2s pulse)
//   green #52c41a = finished (steady)
//   gray #c0c4cc  = no task (steady)
// The breathing animation lives on a CSS class (globals.css,
// `wt-session-pulse`) so prefers-reduced-motion can kill it — an
// inline animation cannot be overridden.

const STATE_STYLE: Record<WorkerSessionState, { color: string; label: string; pulse: boolean }> = {
  running: { color: '#3b82f6', label: '运行中', pulse: true },
  waiting_user: { color: '#d97706', label: '等待人工', pulse: false },
  done: { color: '#52c41a', label: '运行完成', pulse: false },
  // Theme token: the old fixed #c0c4cc is ~1.6:1 on light backgrounds (UI-02).
  idle: { color: 'var(--muted-foreground)', label: '无任务', pulse: false },
};

export function WorkerSessionDot({
  state,
  className = '',
}: {
  state: WorkerSessionState;
  className?: string;
}) {
  const s = STATE_STYLE[state];
  return (
    <span
      role="img"
      aria-label={s.label}
      title={s.label}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${s.pulse ? 'wt-session-pulse' : ''} ${className}`}
      style={{ backgroundColor: s.color }}
    />
  );
}

/** Team-room variant: the blue running dot, or nothing at all. */
export function WorkerSessionRunningDot({ running }: { running: boolean }) {
  if (!running) return null;
  return <WorkerSessionDot state="running" />;
}

// Avatar-corner variant (9/18 chat convention, reused 9/19 by the member
// list): 10px dot pinned to the avatar's bottom-right with a ring in the
// surface color. Same three states / colors as the message-bubble dots.
// The parent element must be `relative`.
const CORNER_STYLE: Record<WorkerSessionState, { className: string; label: string }> = {
  waiting_user: { className: 'bg-amber-500', label: '等待人工' },
  running: {
    className: 'worker-status-breathe bg-sky-500',
    label: '运行中',
  },
  done: { className: 'bg-emerald-500', label: '已完成（10 分钟内）' },
  idle: { className: 'bg-zinc-400/70', label: '空闲' },
};

export function WorkerSessionCornerDot({
  state,
  ringClassName = 'ring-background',
}: {
  state: WorkerSessionState;
  ringClassName?: string;
}) {
  const s = CORNER_STYLE[state];
  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 w-2.5 h-2.5 rounded-full ring-2 ${ringClassName} ${s.className}`}
      title={s.label}
      aria-label={s.label}
    />
  );
}
