import type { ReactNode } from 'react';
import { ListTodo, Users, FolderTree, MessagesSquare } from 'lucide-react';
import type { RoomContextTab } from './RoomContextPanel';

const tabs = [
  { id: 'tasks', label: '任务', icon: ListTodo },
  { id: 'members', label: '成员', icon: Users },
  { id: 'files', label: '文件', icon: FolderTree },
  { id: 'thread', label: '话题', icon: MessagesSquare },
] as const;

export function RoomContextTabs({ activeTab, onTabChange, showMembers = true, showTasks = true, vertical = false, memberCount = 0, threadCount = 0, taskCount, children }: {
  activeTab: RoomContextTab | null;
  onTabChange: (_tab: RoomContextTab | null) => void;
  showMembers?: boolean;
  showTasks?: boolean;
  vertical?: boolean;
  memberCount?: number;
  threadCount?: number;
  taskCount?: number;
  children?: ReactNode;
}) {
  const entries = tabs.filter(tab => (showMembers || tab.id !== 'members') && (showTasks || tab.id !== 'tasks'));
  return <nav aria-label="会话资料" className={vertical ? 'flex w-full flex-col items-center gap-2 py-2' : 'flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2 py-1.5 custom-scrollbar'}>
    {entries.map(tab => {
      const Icon = tab.icon;
      const count = tab.id === 'members' ? memberCount : tab.id === 'thread' ? threadCount : 0;
      const taskBadge = vertical && tab.id === 'tasks' ? taskCount : undefined;
      return <button key={tab.id} type="button" data-context-tab={tab.id} aria-label={`${tab.label}${taskBadge !== undefined ? ` ${taskBadge}` : count ? ` ${count}` : ''}`} aria-pressed={activeTab === tab.id} title={tab.label} onClick={() => onTabChange(tab.id)} className={`relative shrink-0 rounded-md px-2 py-1 text-xs transition-colors ${activeTab === tab.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
        {vertical ? <><Icon className="size-4" />
          {taskBadge !== undefined && <span data-task-count aria-hidden="true" className="absolute -right-0.5 -top-1 min-w-3.5 rounded-full bg-muted px-0.5 text-xs font-semibold leading-3.5 tabular-nums text-foreground ring-1 ring-card">{taskBadge > 99 ? '99+' : taskBadge}</span>}
        </> : <>{tab.label}{count > 0 && <span className="ml-0.5 font-mono">{count}</span>}</>}
      </button>;
    })}
    {children}
  </nav>;
}
