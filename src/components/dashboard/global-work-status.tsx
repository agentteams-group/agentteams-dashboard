'use client';

import { useState } from 'react';
import { useAssistantTaskFeed } from '@/hooks/use-assistant-task-feed';
import { workflowTaskNotes } from '@/lib/assistant-task-notes';
import { hashForSection } from '@/lib/nav-hash';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const groups = [
  { label: '进行中', statuses: ['running'] },
  { label: '待验收', statuses: ['review'] },
  { label: '异常', statuses: ['failed', 'blocked', 'revision'] },
];

export function GlobalWorkStatus({ onNavClick }: { onNavClick: (_section: string) => void }) {
  // Controller projects are filtered by the authenticated account; share the
  // same workflow queries used by the conversation intervention entry.
  const { workflows, loading, degraded, partialError } = useAssistantTaskFeed();
  const tasks = workflowTaskNotes(workflows);
  const [open, setOpen] = useState<string | null>(null);
  const unavailable = degraded || partialError;
  return <div role="group" aria-label="工作状态" className="hidden shrink-0 items-center gap-1 xl:flex">
    {groups.map(group => {
      const items = tasks.filter(task => group.statuses.includes(task.group));
      const count = loading ? '…' : unavailable ? '—' : items.length;
      return <Popover key={group.label} open={open === group.label} onOpenChange={value => setOpen(value ? group.label : null)}>
        <PopoverTrigger asChild>
          <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground" aria-label={`${group.label} ${count}`}>
            {group.label}<span className="font-mono text-foreground">{count}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-80 max-w-[90vw]">
          <h3 className="text-sm font-semibold">{group.label}</h3>
          <p className="mt-1 text-xs text-muted-foreground">当前账号可见的任务</p>
          {loading && <p className="mt-3 text-sm" role="status">正在同步任务…</p>}
          {unavailable && <p className="mt-3 text-sm" role="status">任务状态暂时无法完整更新，请稍后重试。</p>}
          {!loading && !unavailable && items.length === 0 && <p className="mt-3 text-sm text-muted-foreground">暂无{group.label}任务</p>}
          <div className="mt-3 max-h-[50vh] space-y-2 overflow-y-auto custom-scrollbar">
            {items.map(task => <button key={task.id} className="block w-full rounded-md border border-border p-3 text-left text-sm hover:bg-muted" onClick={() => {
              if (!task.projectId) return;
              useHitlInboxStore.getState().setPendingProjectKey({ id: task.projectId, ...(task.teamId ? { team: task.teamId } : {}) });
              setOpen(null);
              onNavClick('tasks');
              window.location.hash = `#${hashForSection('tasks')}?project=${encodeURIComponent(task.projectId)}`;
            }}>
              <span className="block font-medium">{task.title}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{[task.projectTitle, task.assignee].filter(Boolean).join(' · ')}</span>
            </button>)}
          </div>
        </PopoverContent>
      </Popover>;
    })}
  </div>;
}
