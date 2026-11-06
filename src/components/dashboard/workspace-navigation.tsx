'use client';

import { Bot, Hammer, Library, Users } from 'lucide-react';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { openChatRoom } from '@/lib/open-chat-room';
import { preferredAgentRoom } from './sections/chat/agent-conversations';
import type { RoomInfo } from './sections/chat/room-info';
import { isNavItemVisible, navItems, type DeploymentMode } from './nav-items';

export const workspaceMenus = [
  { id: 'chat', label: '助手', icon: Bot, sections: ['chat'] },
  { id: 'my-workbench', label: '工作台', icon: Hammer, sections: ['my-workbench', 'tasks', 'artifacts', 'coding-runs', 'loops'] },
  { id: 'models', label: '资产中心', icon: Library, sections: ['models', 'tools', 'skills', 'knowledge'] },
  { id: 'resources', label: '成员与团队', icon: Users, sections: ['resources', 'workers', 'managers', 'humans', 'teams'] },
];

export function workspaceMenuFor(section: string) {
  return workspaceMenus.find(menu => menu.sections.includes(section));
}

interface WorkspaceNavigationProps {
  activeSection: string;
  countMap: Record<string, number>;
  sectionsWithNotifications: Set<string>;
  onNavClick: (_section: string) => void;
  collapsed?: boolean;
  agentRooms?: RoomInfo[];
}

export function WorkspaceNavigation({ activeSection, countMap, sectionsWithNotifications, onNavClick, collapsed, agentRooms = [] }: WorkspaceNavigationProps) {
  const userLevel = useAgentTeamsStore(state => state.userLevel);
  return (
    <nav aria-label="主要功能" className="space-y-2 px-3 py-4">
      {workspaceMenus.map(menu => {
        const active = menu.sections.includes(activeSection);
        const count = menu.id === 'my-workbench' ? countMap['my-workbench'] ?? 0 : menu.id === 'chat' ? countMap.chat ?? 0 : 0;
        const notification = menu.sections.some(section => sectionsWithNotifications.has(section));
        const Icon = menu.icon;
        return (
          <button key={menu.id} type="button" aria-label={menu.label} title={collapsed ? menu.label : undefined} aria-current={active ? 'page' : undefined}
            data-nav-section={menu.id}
            onClick={() => {
              onNavClick(menu.id);
              if (menu.id === 'chat') {
                const current = useRoomMetaStore.getState().activeRoomId;
                const room = agentRooms.find(agent => agent.id === current) ?? preferredAgentRoom(agentRooms, userLevel);
                if (room) openChatRoom(room.id);
              }
            }}
            className={`relative flex min-h-12 w-full items-center gap-3 rounded-xl px-3 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-primary ${collapsed ? 'justify-center' : ''} ${active ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
            <Icon className="size-5 shrink-0" aria-hidden="true" />
            {!collapsed && <span className="truncate">{menu.label}</span>}
            {count > 0 && <span className={`rounded-full bg-primary/10 px-1.5 text-xs text-primary ${collapsed ? 'absolute right-0 top-0' : 'ml-auto'}`}>{count > 99 ? '99+' : count}</span>}
            {notification && !active && count === 0 && <span aria-label="有新动态" className="ml-auto size-2 rounded-full bg-primary" />}
          </button>
        );
      })}
    </nav>
  );
}

export function WorkspaceSectionNav({ activeSection, mode, onNavClick }: { activeSection: string; mode?: DeploymentMode | null; onNavClick: (_section: string) => void }) {
  const userLevel = useAgentTeamsStore(state => state.userLevel);
  const taskBoardVisible = useAgentTeamsStore(state => state.taskBoardVisible);
  const menu = workspaceMenuFor(activeSection);
  // 成员与团队沿用原有容器内分类，避免重复的二级导航。
  if (!menu || menu.id === 'chat' || menu.id === 'resources') return null;
  const items = menu.sections.flatMap(id => {
    const item = navItems.find(entry => entry.id === id);
    return item && isNavItemVisible(item, mode, taskBoardVisible, userLevel) ? [item] : [];
  });
  return (
    <nav aria-label={`${menu.label}分类`} className="flex gap-1 overflow-x-auto border-b border-border px-5 pb-2 md:px-8">
      {items.map(item => <button key={item.id} type="button" aria-current={activeSection === item.id ? 'page' : undefined}
        onClick={() => onNavClick(item.id)}
        className={`shrink-0 rounded-lg px-3 py-2 text-sm transition-colors focus-visible:outline-2 focus-visible:outline-primary ${activeSection === item.id ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-muted hover:text-foreground'}`}>
        {item.label}
      </button>)}
    </nav>
  );
}
