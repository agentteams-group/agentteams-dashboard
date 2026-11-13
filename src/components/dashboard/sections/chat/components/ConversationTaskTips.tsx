'use client';

import { useId, useState } from 'react';
import { ListTodo, Loader2, Hand, CircleX, CirclePause, Circle, CircleAlert, ChevronDown, ChevronUp } from 'lucide-react';
import { useAssistantTaskFeed, type AssistantTaskFeed } from '@/hooks/use-assistant-task-feed';
import { useSessionTick } from '@/hooks/use-worker-session-state';
import { conversationTaskNotes, taskDuration, TASK_NOTE_GROUPS, type AssistantTaskNoteItem } from '@/lib/assistant-task-notes';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { openChatRoom } from '@/lib/open-chat-room';
import { cn } from '@/lib/utils';
import type { RoomInfo } from '../room-info';

export function ConversationTaskTips({ room, rooms, taskFeed }: {
  room: RoomInfo;
  rooms: RoomInfo[];
  taskFeed?: AssistantTaskFeed;
}) {
  const [expanded, setExpanded] = useState(true);
  const listId = useId();
  const now = useSessionTick();
  const confirmations = useHitlInboxStore(state => state.confirmations);
  const localFeed = useAssistantTaskFeed(room, !taskFeed);
  const { workflows, loading, degraded, partialError } = taskFeed ?? localFeed;
  const items = conversationTaskNotes(room, workflows).filter(item => item.group !== 'completed').map(item => ({
    ...item,
    needsApproval: item.group !== 'cancelled' && Object.values(confirmations).some(confirmation =>
      confirmation.runtimeApproval && confirmation.roomId === item.roomId
      && confirmation.sender === item.assignee),
  }));
  if (!items.length) return null;

  const attention = items.filter(item => item.needsApproval || TASK_NOTE_GROUPS.some(group => group.id === item.group && group.attention)).length;
  function targetRoom(item: AssistantTaskNoteItem) {
    return rooms.find(candidate => candidate.id === item.roomId && candidate.id !== room.id && candidate.access === 'joined');
  }

  return <aside role="region" aria-label="当前对话的任务" className={cn('mt-3 mr-3 self-start shrink-0 overflow-hidden rounded-lg border border-border/70 bg-background', expanded ? 'w-64 max-w-[30vw]' : 'w-14')}>
    <button type="button" aria-label={expanded ? '收起对话任务' : '展开对话任务'} aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)} className={cn('flex w-full items-center text-xs text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-primary', expanded ? 'gap-2 px-3 py-2.5' : 'flex-col gap-1 py-2.5')}>
      <ListTodo className="size-3.5 shrink-0" aria-hidden="true" />
      <span className={expanded ? 'flex-1 text-left' : ''}>任务 <span className="font-mono">{items.length}</span></span>
      {attention > 0 && <span aria-label={attention + ' 项需要关注'} className="flex items-center gap-1 text-amber-700 dark:text-amber-400"><CircleAlert className="size-3" aria-hidden="true" />{expanded && attention}</span>}
      {expanded ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronUp className="size-3" aria-hidden="true" />}
    </button>
    {expanded && <div id={listId} className="max-h-64 overflow-y-auto border-t border-border/60 custom-scrollbar">
      {items.map(item => {
        const state = item.needsApproval ? 'confirmation' : item.group;
        const group = TASK_NOTE_GROUPS.find(group => group.id === state)!;
        const assigned = ['assigned', 'delegated'].includes(item.status ?? '');
        const running = state === 'running' && !assigned;
        const label = state === 'confirmation' ? '待审批' : state === 'running' ? assigned ? '已分配' : '执行中' : group.label;
        const Icon = running ? Loader2 : state === 'confirmation' || state === 'review' ? Hand : state === 'failed' ? CircleX : state === 'blocked' ? CirclePause : Circle;
        const color = state === 'failed' ? 'text-red-600 dark:text-red-400' : group.attention ? 'text-amber-700 dark:text-amber-400' : running ? 'text-primary' : 'text-muted-foreground';
        const target = targetRoom(item);
        const duration = taskDuration(item, now);
        const iconLabel = state === 'confirmation' ? '任务需要审批' : state === 'failed' ? '任务失败' : state === 'blocked' ? '任务阻塞' : running ? '任务执行中' : undefined;
        return <button key={item.id} type="button" onClick={() => { if (target) openChatRoom(target.id); }} aria-disabled={!target} aria-label={item.title + '，' + label + '，' + (target ? '进入协作空间' : '协作空间暂不可用')} className="flex w-full items-start gap-2 border-b border-border/40 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary aria-disabled:cursor-default">
          <Icon aria-label={iconLabel} aria-hidden={!iconLabel} className={cn('mt-0.5 size-3.5 shrink-0', color, running && 'animate-spin motion-reduce:animate-none')} />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-xs leading-5 text-foreground">{item.title}</span>
            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-4">
              <span className={color}>{label}</span>
              <span className="tabular-nums text-muted-foreground">{duration === '未开始' || duration === '耗时待同步' ? duration : '耗时 ' + duration}</span>
            </span>
          </span>
        </button>;
      })}
      {(loading || degraded || partialError) && <p role="status" className="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">{degraded || partialError ? '状态待更新' : '同步中…'}</p>}
    </div>}
  </aside>;
}
