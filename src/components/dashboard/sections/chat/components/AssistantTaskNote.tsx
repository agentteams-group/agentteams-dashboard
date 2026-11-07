'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore } from 'react';
import { ChevronRight, Loader2, RefreshCw, StickyNote } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useAssistantTaskFeed, type AssistantTaskFeed } from '@/hooks/use-assistant-task-feed';
import { assistantTaskNotes, TASK_NOTE_GROUPS, type AssistantTaskNoteItem } from '@/lib/assistant-task-notes';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useSectionStore } from '@/lib/section-store';
import { openChatRoom } from '@/lib/open-chat-room';
import type { RoomInfo } from '../room-info';

const WIDE_QUERY = '(min-width: 1280px)';
function subscribeWide(onChange: () => void) {
  const query = window.matchMedia(WIDE_QUERY);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
}
function isWide() { return typeof window !== 'undefined' && Boolean(window.matchMedia?.(WIDE_QUERY).matches); }

function openItem(item: AssistantTaskNoteItem) {
  if (item.confirmationId) {
    openChatRoom(item.roomId);
  } else if (item.projectId) {
    useHitlInboxStore.getState().setPendingProjectKey({ id: item.projectId, ...(item.teamId ? { team: item.teamId } : {}) });
    useSectionStore.getState().setActiveSection('tasks');
  }
}

export function AssistantTaskNote({ room, rooms, contextOpen, onOpen, taskFeed }: {
  room: RoomInfo;
  rooms: RoomInfo[];
  contextOpen: boolean;
  onOpen: () => void;
  taskFeed?: AssistantTaskFeed;
}) {
  const wide = useSyncExternalStore(subscribeWide, isWide, () => false);
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = !contextOpen && (open ?? wide);
  const panelId = useId();
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
      toast.info(`新增 ${added} 项需要关注的任务`, { id: `task-note-${room.id}`, action: { label: '查看便签', onClick: () => { onOpen(); setOpen(true); } } });
    }
  }, [attentionIds, loading, expanded, onOpen, room.id]);

  useEffect(() => {
    if (!expanded || wide) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [expanded, wide]);

  const summary = `${actionable.length} 项待处理${degraded || partialError ? ' · 数据待更新' : ''}`;
  if (!expanded) {
    return (
      <div className="flex w-9 shrink-0 flex-col items-center sm:w-11 border-l border-border bg-muted/30 py-4">
        <button type="button" aria-label={`展开任务便签，${summary}`} aria-expanded={false} aria-controls={panelId} onClick={() => { onOpen(); setOpen(true); }} className="flex w-full flex-col items-center gap-3 px-1 py-2 text-primary focus-visible:outline-2 focus-visible:outline-primary">
          <StickyNote className="size-4" aria-hidden="true" />
          <span className="text-xs [writing-mode:vertical-rl]">任务便签</span>
          {loading ? <Loader2 className="size-3 animate-spin" aria-label="任务加载中" /> : <span className={`rounded-full px-1.5 py-0.5 text-xs ${actionable.length ? 'bg-amber-500/15 text-amber-700 dark:text-amber-400' : 'bg-muted text-muted-foreground'}`}>{actionable.length}</span>}
        </button>
        <span className="sr-only" role="status" aria-live="polite">{summary}</span>
      </div>
    );
  }

  return (
    <>
      {!wide && <button type="button" aria-label="收起任务便签遮罩" className="fixed inset-0 z-40 bg-background/70" onClick={() => setOpen(false)} />}
      <aside id={panelId} aria-label="任务便签" className="fixed inset-y-0 right-0 z-50 flex w-72 max-w-[88vw] shrink-0 flex-col border-l border-border bg-background xl:static xl:z-auto xl:max-w-none xl:bg-muted/20">
        <div className="flex h-18 shrink-0 items-center gap-2 border-b border-border px-4">
          <StickyNote className="size-4 text-primary" aria-hidden="true" />
          <h3 className="flex-1 text-sm font-semibold">任务便签</h3>
          <Button variant="ghost" size="icon" className="size-8" aria-label="刷新任务便签" onClick={refresh}><RefreshCw className="size-3.5" /></Button>
          <Button variant="ghost" size="icon" className="size-8" aria-label="收起任务便签" aria-expanded={true} onClick={() => setOpen(false)}><ChevronRight className="size-4" /></Button>
        </div>
        <div className="px-4 pb-2 pt-4">
          <p className="text-sm text-muted-foreground">{room.agentRole === 'operations' ? '当前账号可见的任务' : '当前团队的任务'}</p>
          <p className={`mt-1 text-sm font-medium ${actionable.length ? 'text-amber-700 dark:text-amber-400' : 'text-foreground'}`} role="status" aria-live="polite">{loading ? '正在同步任务…' : summary}</p>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto custom-scrollbar p-4">
          {(degraded || partialError) && <p className="rounded-lg border border-status-waiting/25 bg-status-waiting/5 p-3 text-sm leading-6 text-status-waiting" role="status">{degraded ? '任务暂时无法更新' : '部分任务暂时无法更新'}，请稍后刷新。已显示的事项仍可查看。</p>}
          {loading && items.length === 0 && <p className="py-3 text-sm text-muted-foreground">正在加载任务…</p>}
          {!loading && !degraded && !partialError && items.length === 0 && <div className="space-y-2 py-4"><p className="text-sm font-medium">暂时没有分配的任务</p><p className="text-sm leading-6 text-muted-foreground">任务进度、待验收和需要你确认的事项会显示在这里。</p></div>}
          {TASK_NOTE_GROUPS.map(group => {
            const groupItems = items.filter(item => item.group === group.id);
            if (groupItems.length === 0) return null;
            return <section key={group.id} className="space-y-2">
              <h4 className={`flex items-center justify-between text-sm font-medium ${group.id === 'failed' ? 'text-red-600 dark:text-red-400' : group.attention ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground'}`}>{group.label}<span>{groupItems.length}</span></h4>
              {groupItems.map(item => <button key={item.id} type="button" aria-label={`${item.confirmationId ? '去确认' : '查看任务'}：${item.title}`} onClick={() => openItem(item)} className={`w-full rounded-lg border bg-background px-3 py-3 text-left transition-colors hover:bg-primary/5 focus-visible:outline-2 focus-visible:outline-primary ${group.id === 'failed' ? 'border-red-500/25' : group.attention ? 'border-amber-500/20' : 'border-border/60'}`}>
                <span className="block text-sm font-medium leading-6">{item.title}</span>
                {(item.projectTitle || item.assignee) && <span className="mt-1 block text-sm leading-6 text-muted-foreground">{[item.projectTitle, item.assignee && `负责人 ${item.assignee}`].filter(Boolean).join(' · ')}</span>}
                <span className="mt-2 block text-sm text-primary">{item.confirmationId ? '去确认' : '查看任务'} →</span>
              </button>)}
            </section>;
          })}
        </div>
      </aside>
    </>
  );
}
