'use client';

import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { ListTodo } from 'lucide-react';
import type { BoardTask, TaskStatus } from '@/hooks/use-task-board';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { mainTasks, subtasksOf } from '@/lib/task-hierarchy';
import type { RoomTaskData } from './RoomTasksPanel';

const attentionLabels: Partial<Record<TaskStatus, string>> = {
  completed: '任务已完成',
  submitted: '需要确认',
  revision: '任务需要返工',
  blocked: '任务受阻',
  failed: '任务执行异常',
};

type TaskNotice = {
  key: string;
  title: string;
  label: string;
  created?: boolean;
};

function taskKey(task: BoardTask) {
  return JSON.stringify([task.teamId, task.runId]);
}

function cleanRoomId(roomId?: string) {
  return roomId?.replace(/^room:/, '');
}

function mergeNotices(current: TaskNotice[], next: TaskNotice[]) {
  const replaced = new Set(next.map(notice => notice.key));
  return [...next, ...current.filter(notice => !replaced.has(notice.key))].slice(0, 3);
}

export function RoomTaskActivity({ roomId, managedTeam, managedTeamLabel, platformAssistant, data, panelOpen, onFlightCountChange }: {
  roomId: string;
  managedTeam?: string;
  managedTeamLabel?: string;
  platformAssistant: boolean;
  data: RoomTaskData;
  panelOpen: boolean;
  onFlightCountChange: (_count: number) => void;
}) {
  const confirmations = useHitlInboxStore(state => state.confirmations);
  const [enteredAt] = useState(Date.now);
  const [notices, setNotices] = useState<TaskNotice[]>([]);
  const [flight, setFlight] = useState<TaskNotice[]>([]);
  const previousCount = useRef(data.count);
  const previousStatuses = useRef(new Map<string, TaskStatus>());
  const reportedConfirmations = useRef(new Set<string>());
  const flightCard = useRef<HTMLDivElement>(null);
  const { count, board: { tasks, isLoading, degraded } } = data;

  useLayoutEffect(() => {
    const addedToCount = Math.max(0, count - previousCount.current);
    previousCount.current = count;
    if (isLoading || degraded) return;
    const managed = mainTasks(tasks).filter(task => !task.parentTaskId && (
      platformAssistant || cleanRoomId(task.roomId) === roomId
      || (task.teamId && (task.teamId === managedTeam || task.teamId === managedTeamLabel))
    ));
    const nextNotices: TaskNotice[] = [];

    for (const task of managed) {
      const key = taskKey(task);
      const previous = previousStatuses.current.get(key);
      previousStatuses.current.set(key, task.status);
      if (previous === undefined && task.kind === 'main' && cleanRoomId(task.roomId) === roomId && task.createdAt >= enteredAt) {
        nextNotices.push({ key: `created:${key}`, title: task.title, label: '任务已创建，进展会通知', created: true });
      } else if (previous !== undefined && previous !== task.status) {
        const label = attentionLabels[task.status];
        if (label) nextNotices.push({ key: `status:${key}`, title: task.title, label });
      }
    }

    for (const confirmation of Object.values(confirmations)) {
      if (confirmation.timestamp < enteredAt || reportedConfirmations.current.has(confirmation.id)) continue;
      const executionRoom = cleanRoomId(confirmation.roomId);
      const related = managed.filter(task => executionRoom && [task, ...subtasksOf(task, tasks)]
        .some(member => cleanRoomId(member.executionRoomId) === executionRoom));
      if (related.length !== 1) continue;

      reportedConfirmations.current.add(confirmation.id);
      nextNotices.push({
        key: `confirmation:${confirmation.id}`,
        title: related[0].title,
        label: confirmation.question ? '需要确认' : '需要审批',
      });
    }

    if (!nextNotices.length) return;
    const created = nextNotices.filter(notice => notice.created);
    const canAnimate = created.length > 0 && typeof HTMLElement.prototype.animate === 'function'
      && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (canAnimate) {
      onFlightCountChange(Math.min(created.length, addedToCount));
      setFlight(current => [...created, ...current]);
    }
    const ready = canAnimate ? nextNotices.filter(notice => !notice.created) : nextNotices;
    if (ready.length) setNotices(current => mergeNotices(current, ready));
  }, [confirmations, count, degraded, enteredAt, isLoading, managedTeam, managedTeamLabel, onFlightCountChange, platformAssistant, roomId, tasks]);

  useEffect(() => {
    if (!notices.length) return;
    const timer = setTimeout(() => setNotices([]), 6000);
    return () => clearTimeout(timer);
  }, [notices]);

  const created = flight[0];

  useEffect(() => {
    const card = flightCard.current;
    if (!created || !card) return;
    const layout = card.closest('[data-chat-layout]');
    const target = layout?.querySelector('[data-context-tab="tasks"]');
    const origin = layout?.querySelector('[data-chat-main] textarea');
    const arrive = () => {
      onFlightCountChange(0);
      setNotices(current => mergeNotices(current, flight));
      setFlight([]);
      requestAnimationFrame(() => {
        layout?.querySelector('[data-task-count]')?.animate([
          { transform: 'scale(1)' }, { transform: 'scale(1.35)' }, { transform: 'scale(1)' },
        ], { duration: 250 });
      });
    };
    if (!layout || !target) {
      arrive();
      return;
    }

    const cardRect = card.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const originRect = (origin ?? layout).getBoundingClientRect();
    const endX = targetRect.left + targetRect.width / 2 - cardRect.left - cardRect.width / 2;
    const endY = targetRect.top + targetRect.height / 2 - cardRect.top - cardRect.height / 2;
    const startX = originRect.left + originRect.width / 2 - cardRect.left - cardRect.width / 2;
    const startY = originRect.top + originRect.height / 2 - cardRect.top - cardRect.height / 2;
    const animation = card.animate([
      { transform: `translate(${startX}px, ${startY}px) scale(0.92)`, opacity: 0 },
      { transform: `translate(${startX}px, ${startY - 30}px) scale(1)`, opacity: 1, offset: 0.2 },
      { transform: `translate(${endX}px, ${endY}px) scale(0.18)`, opacity: 0 },
    ], { duration: 520, easing: 'cubic-bezier(.25,.7,.35,1)' });
    animation.onfinish = arrive;
    return () => animation.cancel();
  }, [created, flight, onFlightCountChange]);

  return <>
    {created && <div key={created.key} ref={flightCard} aria-hidden="true" className="pointer-events-none absolute left-0 top-0 z-50 flex max-w-48 items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs font-medium opacity-0 shadow-lg">
      <ListTodo className="size-4 shrink-0" />
      <span className="truncate">{created.title}</span>
    </div>}
    <div role="status" aria-live="polite" aria-atomic="false" className={`pointer-events-none absolute top-10 z-50 flex max-w-[calc(100%-4rem)] flex-col items-end gap-1.5 ${panelOpen ? 'right-3 lg:right-[min(20.75rem,86%)]' : 'right-12'}`}>
      {notices.map(notice => <div key={notice.key} className="flex w-max max-w-full items-start gap-2 rounded-lg border border-border bg-card px-3 py-2 text-xs shadow-md">
        <ListTodo className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-medium">{notice.label}</p>
          <p className="truncate text-muted-foreground" title={notice.title}>{notice.title}</p>
        </div>
      </div>)}
    </div>
  </>;
}
