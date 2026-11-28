'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Circle, CircleDot, GitBranch, FolderOpen, ArrowRight, User, MessageSquare } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useAggregatedTaskBoard } from '@/hooks/use-aggregate-task-board';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { apiUrl, requestJson } from '@/lib/api-base';
import type { WorkflowNotice } from '@/lib/chat-workflow-notice';
import { formatMessageTime } from './format';

interface TaskDetail { summary?: string; result_summary?: string; spec?: string; history?: Array<{ action: string; note?: string }> }
const stages = ['已派发', '已接单', '执行中', '待验收'];
const stageOf: Record<string, number> = { assigned: 0, in_progress: 2, submitted: 3, completed: 3 };
const statusLabels: Record<string, string> = { pending: '待办', assigned: '已派发', in_progress: '执行中', submitted: '待验收', completed: '已完成', blocked: '阻塞', revision: '需修订', failed: '失败', unknown: '待同步' };

export function TaskAssignmentCard({ notice, sender, timestamp, onOpenFiles }: { notice: WorkflowNotice; sender: string; timestamp: number; onOpenFiles?: () => void }) {
  const roomId = useRoomMetaStore(state => state.activeRoomId);
  const board = useAggregatedTaskBoard();
  const matches = board.tasks.filter(task => task.runId === notice.taskId);
  const scoped = matches.filter(task => task.executionRoomId?.replace(/^room:/, '') === roomId || task.roomId === roomId);
  const task = scoped.length === 1 ? scoped[0] : matches.length === 1 ? matches[0] : undefined;
  const [open, setOpen] = useState(false);
  const detail = useQuery({
    queryKey: ['task-detail', task?.runId, task?.teamId],
    queryFn: () => requestJson<TaskDetail>(apiUrl(`/api/agentteams/tasks/${encodeURIComponent(task!.runId)}/meta${task?.teamId ? `?team=${encodeURIComponent(task.teamId)}` : ''}`)),
    enabled: !!task, refetchInterval: 5000, retry: false,
  });
  // Assignment is the only fact known from a historical notification alone.
  const status = task?.status ?? 'assigned';
  const stage = stageOf[status] ?? -1;
  const badgeClass = status === 'failed' ? 'bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300'
    : ['blocked', 'revision'].includes(status) ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
      : ['assigned', 'pending', 'unknown'].includes(status) ? 'bg-muted text-muted-foreground'
        : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300';
  const progress = detail.data?.history?.findLast(item => item.action === 'report_progress' && item.note)?.note;
  const executor = task?.assignedTo?.replace(/^@([^:]+):.*$/, '$1') || notice.description?.replace(/^执行者：\s*/, '') || '待同步';
  return <div role="note" aria-label="任务已分配" data-workflow-notice="assigned" className="mx-4 my-3 max-w-2xl sm:mx-9">
    <div className="mb-3 flex items-center gap-2 text-xs text-muted-foreground"><Avatar className="size-8"><AvatarFallback className="bg-muted text-xs font-semibold">{sender.slice(0, 1).toUpperCase()}</AvatarFallback></Avatar><span className="font-medium text-foreground">{sender}</span><span>{formatMessageTime(timestamp)}</span></div>
    <div className="space-y-5 rounded-xl border border-emerald-200/70 bg-background p-5 dark:border-emerald-900/70">
      <div className="flex items-start gap-2.5"><GitBranch className="mt-1 size-4 shrink-0 text-emerald-700 dark:text-emerald-400" /><div className="min-w-0 flex-1"><h3 className="text-base font-semibold leading-6 text-emerald-800 dark:text-emerald-300">{task?.title || notice.subject || notice.taskId || '任务已分配'}</h3>{notice.taskId && notice.taskId !== (task?.title || notice.subject) && <p className="mt-1 text-sm text-muted-foreground">{notice.taskId}</p>}</div><span className={`shrink-0 rounded-md px-2 py-1 text-xs font-medium ${badgeClass}`}>{statusLabels[status] ?? status}</span></div>
      <ol aria-label="任务执行阶段" className="flex items-center gap-2 text-xs sm:text-sm">
        {stages.map((label, index) => <li key={label} aria-current={stage === index ? 'step' : undefined} className={`flex min-w-0 flex-1 items-center gap-1.5 last:flex-none ${index <= stage ? 'text-emerald-700 dark:text-emerald-400' : 'text-muted-foreground'}`}>
          {index < stage || status === 'completed' ? <CheckCircle2 className="size-4 shrink-0 fill-emerald-600 text-white dark:text-background" /> : index === stage ? <CircleDot className="size-4 shrink-0" /> : <Circle className="size-4 shrink-0" />}<span className={`whitespace-nowrap ${index === stage ? 'rounded-md bg-emerald-100 px-1.5 py-0.5 dark:bg-emerald-950' : ''}`}>{index === 3 && status === 'completed' ? '已完成' : label}</span>{index < stages.length - 1 && <span aria-hidden className={`ml-1 h-px min-w-1 flex-1 ${index < stage ? 'bg-emerald-600' : 'bg-border'}`} />}
        </li>)}
      </ol>
      <p className="flex items-center gap-2 text-sm text-muted-foreground"><User className="size-4" />执行者：{executor}</p>
      {progress && <p className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2 text-sm leading-6"><MessageSquare className="mt-1 size-4 shrink-0 text-muted-foreground" />{progress}</p>}
      {!task && <p className="text-xs text-muted-foreground">派发时的通知，当前执行状态暂未同步。</p>}
      <div className="flex flex-wrap items-center gap-2">
        {task && <Button size="sm" className="gap-2 bg-emerald-600 px-4 text-sm text-white hover:bg-emerald-700" onClick={() => setOpen(true)}>查看执行详情<ArrowRight className="size-4" /></Button>}
        {onOpenFiles && <Button variant="outline" size="sm" className="gap-2 text-sm" onClick={onOpenFiles}><FolderOpen className="size-4" />查看产物</Button>}
        <details className="ml-auto text-xs text-muted-foreground"><summary className="cursor-pointer">原始通知</summary><pre className="mt-2 max-h-48 overflow-auto whitespace-pre-wrap break-words">{notice.body}</pre></details>
      </div>
    </div>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent><DialogTitle>{task?.title || notice.subject}</DialogTitle><DialogDescription>{statusLabels[status] ?? status} · {executor}</DialogDescription>
      {detail.isError ? <p role="alert">详情暂时无法加载<Button variant="ghost" onClick={() => detail.refetch()}>重试</Button></p> : detail.isPending ? <p role="status">正在加载详情…</p> : <div className="max-h-96 overflow-auto whitespace-pre-wrap text-sm leading-6">{progress || detail.data?.result_summary || detail.data?.summary || task?.spec || '暂无进展说明'}</div>}
    </DialogContent></Dialog>
  </div>;
}
