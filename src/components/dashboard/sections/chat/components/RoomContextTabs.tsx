import type { ReactNode } from 'react';
import { StickyNote, ListTodo, Users, FolderTree, MessagesSquare, Network } from 'lucide-react';
import type { RoomContextTab } from './RoomContextPanel';

const tabs = [
  { id: 'tasks', label: '任务', icon: ListTodo },
  { id: 'members', label: '成员', icon: Users },
  { id: 'files', label: '文件', icon: FolderTree },
  { id: 'thread', label: '话题', icon: MessagesSquare },
  { id: 'overview', label: '概览', icon: Network },
] as const;

export function RoomContextTabs({ activeTab, onTabChange, includeNotes = false, vertical = false, memberCount = 0, threadCount = 0, children }: {
  activeTab: RoomContextTab | null;
  onTabChange: (_tab: RoomContextTab | null) => void;
  includeNotes?: boolean;
  vertical?: boolean;
  memberCount?: number;
  threadCount?: number;
  children?: ReactNode;
}) {
  const entries = includeNotes ? [{ id: null, label: '便签', icon: StickyNote }, ...tabs] : tabs;
  return <nav aria-label="会话资料" className={vertical ? 'flex w-full flex-col items-center gap-2 py-2' : 'flex shrink-0 items-center gap-0.5 overflow-x-auto border-b border-border px-2 py-1.5 custom-scrollbar'}>
    {entries.map(tab => {
      const Icon = tab.icon;
      const count = tab.id === 'members' ? memberCount : tab.id === 'thread' ? threadCount : 0;
      return <button key={tab.id ?? 'notes'} type="button" aria-label={tab.label === '便签' ? '任务便签' : `${tab.label}${count ? ` ${count}` : ''}`} aria-pressed={activeTab === tab.id} title={tab.label === '便签' ? '任务便签' : tab.label} onClick={() => onTabChange(tab.id)} className={`shrink-0 rounded-md px-2 py-1 text-xs transition-colors ${activeTab === tab.id ? 'bg-muted font-medium text-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
        {vertical ? <Icon className="size-4" /> : <>{tab.label}{count > 0 && <span className="ml-0.5 font-mono">{count}</span>}</>}
      </button>;
    })}
    {children}
  </nav>;
}
