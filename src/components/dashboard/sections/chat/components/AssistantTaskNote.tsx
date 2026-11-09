'use client';

import { useEffect, useRef, useState } from 'react';
import { Loader2, RefreshCw, Hand } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAssistantTaskFeed, type AssistantTaskFeed } from '@/hooks/use-assistant-task-feed';
import { assistantTaskNotes, TASK_NOTE_GROUPS, type AssistantTaskNoteItem } from '@/lib/assistant-task-notes';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useSectionStore } from '@/lib/section-store';
import { openChatRoom } from '@/lib/open-chat-room';
import type { RoomInfo } from '../room-info';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

function openItem(item: AssistantTaskNoteItem) {
  if (item.confirmationId) {
    openChatRoom(item.roomId);
  } else if (item.projectId) {
    useHitlInboxStore.getState().setPendingProjectKey({ id: item.projectId, ...(item.teamId ? { team: item.teamId } : {}) });
    useSectionStore.getState().setActiveSection('tasks');
  }
}

export function AssistantTaskNote({ room, rooms, taskFeed }: {
  room: RoomInfo;
  rooms: RoomInfo[];
  taskFeed?: AssistantTaskFeed;
}) {
  const [expanded, setOpen] = useState(false);
  const confirmations = useHitlInboxStore(state => state.confirmations);
  const localFeed = useAssistantTaskFeed(room, !taskFeed);
  const { workflows, loading, degraded, partialError, refresh } = taskFeed ?? localFeed;
  const items = assistantTaskNotes(room, rooms, workflows, confirmations);
  const actionable = items.filter(item => TASK_NOTE_GROUPS.some(group => group.id === item.group && group.attention));
  const attentionIds = actionable.map(item => `${item.id}:${item.group}`);
  const previousAttention = useRef<Set<string> | null>(null);

  useEffect(() => {
    if (loading) return;
    const current = new Set(attentionIds);
    const added = previousAttention.current ? attentionIds.filter(id => !previousAttention.current!.has(id)).length : 0;
    previousAttention.current = current;
    if (added > 0 && !expanded) {
      toast.info(`新增 ${added} 项需要关注的任务`, { id: `task-note-${room.id}`, action: { label: '查看待办', onClick: () => setOpen(true) } });
    }
  }, [attentionIds, loading, expanded, room.id]);

  const summary = `${actionable.length} 项待处理${degraded || partialError ? ' · 数据待更新' : ''}`;
  return (
    <Popover open={expanded} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-1.5" aria-label={`待我处理，${summary}`} disabled={actionable.length === 0 && !loading && !degraded && !partialError}>
          <Hand className="size-4" aria-hidden="true" />
          <span>待我处理</span>
          {loading ? <Loader2 className="size-3 animate-spin" aria-label="任务加载中" /> : <span className={actionable.length ? 'font-mono text-amber-700 dark:text-amber-400' : 'font-mono'}>· {actionable.length}</span>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[90vw] p-0" aria-label="待我处理">
        <div className="flex items-center justify-between border-b border-border px-4 py-2">
          <h3 className="text-sm font-semibold">待我处理</h3>
          <Button variant="ghost" size="icon" className="size-8" aria-label="刷新待我处理" onClick={refresh}><RefreshCw className="size-3.5" /></Button>
        </div>
        <div className="max-h-[60vh] space-y-4 overflow-y-auto custom-scrollbar p-4">
          {(degraded || partialError) && <p className="rounded-lg border border-status-waiting/25 bg-status-waiting/5 p-3 text-sm leading-6 text-status-waiting" role="status">{degraded ? '任务暂时无法更新' : '部分任务暂时无法更新'}，请稍后刷新。已显示的事项仍可查看。</p>}
          {loading && actionable.length === 0 && <p className="py-3 text-sm text-muted-foreground">正在加载任务…</p>}
          {!loading && !degraded && !partialError && actionable.length === 0 && <div className="space-y-2 py-4"><p className="text-sm font-medium">当前没有需要你处理的事项</p><p className="text-sm leading-6 text-muted-foreground">需要你确认、验收或介入的任务会显示在这里。</p></div>}
          {TASK_NOTE_GROUPS.map(group => {
            const groupItems = actionable.filter(item => item.group === group.id);
            if (groupItems.length === 0) return null;
            return <section key={group.id} className="space-y-2">
              <h4 className={`flex items-center justify-between text-sm font-medium ${group.id === 'failed' ? 'text-red-600 dark:text-red-400' : group.attention ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{group.label}<span>{groupItems.length}</span></h4>
              {groupItems.map(item => <button key={item.id} type="button" aria-label={`${item.confirmationId ? '去确认' : '查看任务'}：${item.title}`} onClick={() => { setOpen(false); openItem(item); }} className={`w-full rounded-lg border bg-background px-3 py-3 text-left transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary ${group.id === 'failed' ? 'border-red-500/25' : group.attention ? 'border-amber-500/20' : 'border-border/60'}`}>
                <span className="block text-sm font-medium leading-6">{item.title}</span>
                {(item.projectTitle || item.assignee) && <span className="mt-1 block text-sm leading-6 text-muted-foreground">{[item.projectTitle, item.assignee && `负责人 ${item.assignee}`].filter(Boolean).join(' · ')}</span>}
                <span className="mt-2 block text-sm text-primary">{item.confirmationId ? '去确认' : '查看任务'} →</span>
              </button>)}
            </section>;
          })}
        </div>
      </PopoverContent>
    </Popover>
  );
}
