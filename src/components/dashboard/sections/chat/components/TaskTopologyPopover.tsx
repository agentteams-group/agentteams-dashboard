'use client';

import { useEffect, useRef, useState } from 'react';
import { GitBranch } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useApiTaskBoard } from '@/hooks/use-projects';
import type { BoardTask } from '@/hooks/use-task-board';
import { Button } from '@/components/ui/button';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { RoomTasksPanel, useRoomTaskData, type RoomTaskData } from './RoomTasksPanel';
import { completedTaskDuration, StatusBadge, SubtaskProgress, TaskDependencies, taskMetaQuery } from '../../task-detail-sheet';
import { subtasksOf } from '@/lib/task-hierarchy';
import { isComposing, isDesktopHover } from '@/lib/desktop-interactions';

export function TaskTopologyPopover({ roomId, taskId, roomTaskData }: { roomId: string; taskId?: string; roomTaskData?: RoomTaskData }) {
  const [open, setOpen] = useState(false);
  const pinned = useRef(false);
  const openedByHover = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clear = () => { if (timer.current) clearTimeout(timer.current); timer.current = null; };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const enter = () => { clear(); openedByHover.current = true; timer.current = setTimeout(() => { if (!isComposing()) setOpen(true); }, 250); };
  const leave = () => { clear(); if (!pinned.current) timer.current = setTimeout(() => setOpen(false), 200); };

  return <Popover open={open} onOpenChange={value => { clear(); pinned.current = false; setOpen(value); }}>
    <PopoverAnchor asChild>
      <Button variant={open ? 'secondary' : 'ghost'} size="sm" className="h-8 gap-1.5 px-2 text-sm" aria-label="任务拓扑" aria-haspopup="dialog" aria-expanded={open}
        onPointerEnter={event => { if (isDesktopHover(event)) enter(); }} onPointerLeave={leave} onClick={() => { clear(); openedByHover.current = false; const next = !pinned.current; pinned.current = next; setOpen(next); }}>
        <GitBranch className="size-4" />任务拓扑
      </Button>
    </PopoverAnchor>
    <PopoverContent role="dialog" aria-label="任务拓扑" align="end" side="bottom" sideOffset={8} className="w-[min(90vw,52rem)] max-h-[min(70vh,32rem)] overflow-auto rounded-xl border-border/70 p-0 shadow-lg" onPointerEnter={clear} onPointerLeave={leave} onOpenAutoFocus={event => event.preventDefault()} onCloseAutoFocus={event => { if (openedByHover.current) event.preventDefault(); }}>
      {roomTaskData
        ? <RoomTopology roomId={roomId} taskId={taskId} data={roomTaskData} />
        : <StandaloneRoomTopology roomId={roomId} taskId={taskId} />}
    </PopoverContent>
  </Popover>;
}

function StandaloneRoomTopology({ roomId, taskId }: { roomId: string; taskId?: string }) {
  const board = useApiTaskBoard();
  const data = useRoomTaskData(roomId, board);
  return <RoomTopology roomId={roomId} taskId={taskId} data={data} />;
}

function RoomTopology({ roomId, taskId, data }: { roomId: string; taskId?: string; data: RoomTaskData }) {
  const { board, roots } = data;
  const matchesRoom = (task: BoardTask) => task.executionRoomId?.replace(/^room:/, '') === roomId;
  const byId = board.tasks.filter(task => task.runId === taskId);
  const current = byId.find(matchesRoom)
    ?? board.tasks.find(matchesRoom)
    ?? (byId.length === 1 ? byId[0] : undefined);
  const root = current
    ? roots.find(task => task === current || subtasksOf(task, board.tasks).includes(current)) ?? current
    : roots[0];
  if (!root) return <RoomTasksPanel roomId={roomId} data={data} />;

  const prefix = `${root.runId}-`;
  const tasks = board.tasks
    .filter(task => task.teamId === root.teamId && task.projectId === root.projectId)
    .map(task => task.title === task.runId && task.runId.startsWith(prefix)
      ? { ...task, title: task.runId.slice(prefix.length) }
      : task);
  return <TaskTopology key={JSON.stringify([root.teamId, root.runId])} task={root} tasks={tasks} />;
}

function TaskTopology({ task, tasks }: { task: BoardTask; tasks: BoardTask[] }) {
  const detail = useQuery({
    ...taskMetaQuery(task.runId, task.teamId),
    enabled: task.kind !== 'project-summary',
    staleTime: 5000,
    refetchInterval: task.status === 'completed' ? false : 5000,
  });
  const meta = detail.data;
  const summary = meta?.summary || meta?.description || meta?.spec || task.spec;
  const latestProgress = meta?.history?.findLast(event => event.action === 'report_progress' && event.note)?.note;
  const progressNote = task.status === 'completed' ? meta?.result_summary || latestProgress : latestProgress;
  const elapsed = completedTaskDuration(task, meta);

  return <div className="space-y-4 p-4 sm:p-5">
    <section aria-label="任务概要" className="space-y-2">
      <h3 className="text-xs font-medium text-muted-foreground">任务概要</h3>
      <h4 className="break-words text-base font-semibold">{task.title}</h4>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span className="break-all font-mono">{task.runId}</span>
        {task.assignedTo && <span>负责人 {task.assignedTo}</span>}
      </div>
      {summary && <p className="line-clamp-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-muted-foreground" title={summary}>{summary}</p>}
    </section>
    <section aria-label="当前进度" className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="mr-auto text-xs font-medium">当前进度</h3>
        {elapsed && <span className="text-xs text-muted-foreground">总耗时 {elapsed}</span>}
        <StatusBadge status={task.status} />
      </div>
      <SubtaskProgress task={task} tasks={tasks} />
      {progressNote && <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground" title={progressNote}>{progressNote}</p>}
    </section>
    <TaskDependencies task={task} tasks={tasks} showSingleTask />
  </div>;
}
