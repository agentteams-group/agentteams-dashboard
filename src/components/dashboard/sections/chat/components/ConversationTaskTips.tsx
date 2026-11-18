'use client';

import { useEffect, useId, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ListTodo, Loader2, Hand, CircleX, CirclePause, CircleDashed, CircleAlert, ChevronDown, ChevronUp, ChevronRight, Clock3, ClipboardCheck, CircleHelp, CircleMinus, Undo2, CircleCheck } from 'lucide-react';
import { useAssistantTaskFeed, type AssistantTaskFeed } from '@/hooks/use-assistant-task-feed';
import { useTaskIndex } from '@/hooks/use-projects';
import { useArchivedRooms } from '@/hooks/use-room-archive';
import { useChatRoomAccess } from '@/hooks/use-chat-room-access';
import { ApiError } from '@/lib/api-error';
import { conversationTaskNotes, taskDuration, TASK_NOTE_GROUPS } from '@/lib/assistant-task-notes';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { openChatRoom } from '@/lib/open-chat-room';
import { cn } from '@/lib/utils';
import type { RoomInfo } from '../room-info';

const createdTime = new Intl.DateTimeFormat('zh-CN', {
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
});

const statusIcons = {
  confirmation: Hand,
  review: ClipboardCheck,
  failed: CircleX,
  blocked: CirclePause,
  revision: Undo2,
  pending: CircleDashed,
  completed: CircleCheck,
  cancelled: CircleMinus,
  unknown: CircleHelp,
};

export function ConversationTaskTips({ room, taskFeed }: {
  room: RoomInfo;
  taskFeed?: AssistantTaskFeed;
}) {
  const [expanded, setExpanded] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const reduceMotion = useReducedMotion();
  const listId = useId();
  const confirmations = useHitlInboxStore(state => state.confirmations);
  const localFeed = useAssistantTaskFeed(room, !taskFeed);
  const { workflows, loading, degraded, partialError } = taskFeed ?? localFeed;
  const taskIndex = useTaskIndex();
  const archivedRooms = useArchivedRooms();
  const roomAccess = useChatRoomAccess();
  const archivedIds = new Set(archivedRooms.data?.rooms.map(room => room.room_id));
  const taskIndexError = taskIndex.isError && !(taskIndex.error instanceof ApiError && taskIndex.error.status === 404);
  const items = conversationTaskNotes(room, workflows, taskIndex.data?.tasks).filter(item =>
    item.group !== 'completed' && (!item.roomId || !archivedIds.has(item.roomId)),
  ).map(item => {
    const pending = Object.values(confirmations).filter(confirmation =>
      item.group !== 'cancelled' && confirmation.roomId === item.roomId && confirmation.sender === item.assignee,
    );
    const waitingFor = pending.some(confirmation => !confirmation.question) ? 'approval' : pending.length ? 'confirmation' : null;
    return { ...item, waitingFor };
  });

  // The backend status polls every five seconds. Only the displayed clock ticks locally.
  const ticking = expanded && items.some(item => item.group === 'running' && (item.startedAt || item.createdAt));
  useEffect(() => {
    if (!ticking) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [ticking]);

  const attention = items.filter(item => item.waitingFor || TASK_NOTE_GROUPS.some(group => group.id === item.group && group.attention)).length;
  const joinedIds = new Set(roomAccess.state === 'joined' ? roomAccess.joinedRooms : []);

  return <AnimatePresence initial={false}>{items.length > 0 && <motion.aside
    role="region" aria-label="当前对话的任务"
    initial={{ opacity: 0, x: reduceMotion ? 0 : 6 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}
    transition={{ duration: reduceMotion ? 0 : 0.16 }}
    className={cn('mt-3 mr-3 self-start shrink-0 overflow-hidden rounded-lg border border-border/70 bg-background', expanded ? 'w-64 max-w-[30vw]' : 'w-14')}>
    <button type="button" aria-label={expanded ? '收起对话任务' : '展开对话任务'} aria-expanded={expanded} aria-controls={listId} onClick={() => setExpanded(value => !value)} className={cn('flex w-full items-center text-xs text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-primary', expanded ? 'gap-2 px-3 py-2.5' : 'flex-col gap-1 py-2.5')}>
      <ListTodo className="size-3.5 shrink-0" aria-hidden="true" />
      <span className={expanded ? 'flex-1 text-left' : ''}>任务 <span className="font-mono">{items.length}</span></span>
      {attention > 0 && <span aria-label={attention + ' 项需要关注'} className="flex items-center gap-1 text-amber-700 dark:text-amber-400"><CircleAlert className="size-3" aria-hidden="true" />{expanded && attention}</span>}
      {expanded ? <ChevronDown className="size-3.5" aria-hidden="true" /> : <ChevronUp className="size-3" aria-hidden="true" />}
    </button>
    {expanded && <div id={listId} className="relative max-h-64 overflow-y-auto border-t border-border/60 custom-scrollbar">
      <AnimatePresence initial={false} mode="popLayout">
      {items.map(item => {
        const state = item.waitingFor ? 'confirmation' : item.group;
        const group = TASK_NOTE_GROUPS.find(group => group.id === state)!;
        const assigned = ['assigned', 'delegated'].includes(item.status ?? '');
        const running = state === 'running' && !assigned;
        const label = item.waitingFor === 'approval' ? '待审批' : item.waitingFor === 'confirmation' ? '待确认' : state === 'running' ? assigned ? '已分配' : '执行中' : group.label;
        const Icon = state === 'running' ? assigned ? Clock3 : Loader2 : item.waitingFor === 'confirmation' ? CircleHelp : statusIcons[state];
        const color = state === 'failed' ? 'text-red-600 dark:text-red-400' : group.attention ? 'text-amber-700 dark:text-amber-400' : running ? 'text-primary' : 'text-muted-foreground';
        const target = item.roomId && joinedIds.has(item.roomId) ? item.roomId : undefined;
        const duration = taskDuration(item, now);
        const created = item.createdAt ? Date.parse(item.createdAt) : NaN;
        const detailsId = `${listId}-${encodeURIComponent(item.id)}`;
        const iconLabel = item.waitingFor === 'approval' ? '任务需要审批' : `任务${label}`;
        return <motion.button key={`${item.id}:${item.status}:${label}`} type="button"
          layout={reduceMotion ? false : 'position'}
          initial={{ opacity: 0, y: reduceMotion ? 0 : 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: reduceMotion ? 0 : -4 }}
          transition={{ duration: reduceMotion ? 0 : 0.16 }}
          onClick={() => { if (target) openChatRoom(target, item.mainTaskId); }} aria-disabled={!target} aria-describedby={detailsId} aria-label={item.title + '，' + label + '，' + (target ? '进入协作空间' : '协作空间暂不可用')} className="flex w-full items-start gap-2 border-b border-border/40 px-3 py-2.5 text-left transition-colors last:border-0 hover:bg-muted/40 focus-visible:outline-2 focus-visible:outline-primary aria-disabled:cursor-default">
          <Icon aria-label={iconLabel} className={cn('mt-0.5 size-3.5 shrink-0', color, running && 'animate-spin motion-reduce:animate-none')} />
          <span className="min-w-0 flex-1">
            <span className="line-clamp-2 text-xs leading-5 text-foreground">{item.title}</span>
            <span id={detailsId} className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs leading-4">
              <span className={color}>{label}</span>
              <span className="tabular-nums text-muted-foreground">{duration === '未开始' || duration === '耗时待同步' ? duration : '耗时 ' + duration}</span>
              <span className="basis-full tabular-nums text-muted-foreground">{Number.isFinite(created)
                ? <>创建于 <time dateTime={item.createdAt}>{createdTime.format(created)}</time></>
                : '创建时间未知'}</span>
            </span>
          </span>
          {target && <ChevronRight className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}
        </motion.button>;
      })}
      </AnimatePresence>
      {(loading || degraded || partialError || taskIndex.isLoading || taskIndexError) && <p role="status" className="border-t border-border/40 px-3 py-2 text-xs text-muted-foreground">{degraded || partialError || taskIndexError ? '状态待更新' : '同步中…'}</p>}
    </div>}
  </motion.aside>}</AnimatePresence>;
}
