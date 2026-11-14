'use client';

import { useEffect, useId, useState } from 'react';
import { Activity, Bot, ChevronDown, Hammer, Library, Users } from 'lucide-react';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { openChatRoom } from '@/lib/open-chat-room';
import { canOpenConversation } from './sections/chat/agent-conversations';
import type { RoomInfo } from './sections/chat/room-info';
import { isNavItemVisible, navItems, type DeploymentMode } from './nav-items';
import { usePluginMenuItems } from '@/lib/plugins/extension-store';
import { pluginSectionId } from '@/lib/plugins/types';

export const OBSERVABILITY_PLUGIN_IDS: readonly string[] = ['monitor-panel'];

export const workspaceMenus = [
  { id: 'chat', label: '助手', icon: Bot, sections: ['chat', 'platform-assistant-settings'] },
  { id: 'my-teams', label: '我的团队', icon: Users, sections: ['my-teams'] },
  { id: 'my-workbench', label: '工作台', icon: Hammer, sections: ['my-workbench', 'tasks', 'artifacts', 'coding-runs', 'loops'] },
  { id: 'models', label: '资产中心', icon: Library, sections: ['models', 'tools', 'skills', 'knowledge', 'files'] },
  { id: 'resources', label: '成员与团队', icon: Users, sections: ['resources', 'workers', 'humans', 'teams'] },
  { id: 'tracing', label: '观测与治理', icon: Activity, sections: ['plugin-route:monitor-panel/monitor', 'tracing', 'audit'] },
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
  mode?: DeploymentMode | null;
  onExpandSidebar?: () => void;
  agentRooms?: RoomInfo[];
}

export function WorkspaceNavigation({ activeSection, countMap, sectionsWithNotifications, onNavClick, collapsed, mode, onExpandSidebar, agentRooms = [] }: WorkspaceNavigationProps) {
  const userLevel = useAgentTeamsStore(state => state.userLevel);
  const taskBoardVisible = useAgentTeamsStore(state => state.taskBoardVisible);
  const pluginMenus = usePluginMenuItems();
  const [expandedMenus, setExpandedMenus] = useState<Record<string, boolean>>({});
  const id = useId();

  useEffect(() => {
    const activeMenu = workspaceMenuFor(activeSection);
    if (activeMenu) setExpandedMenus(previous => previous[activeMenu.id] ? previous : { ...previous, [activeMenu.id]: true });
  }, [activeSection]);

  return (
    <nav aria-label="主要功能" className="space-y-1 px-3 py-3">
      {workspaceMenus.map(menu => {
        const active = menu.sections.includes(activeSection);
        const items = menu.sections.flatMap<{ id: string; label: string }>(section => {
          const item = navItems.find(entry => entry.id === section);
          if (item) return item.id !== 'chat' && item.id !== 'my-teams' && item.id !== 'resources' && isNavItemVisible(item, mode, taskBoardVisible, userLevel) ? [item] : [];
          // These bundled pages read administrator-only resources. Contributions
          // disappear when their plugin is disabled, so no dead link is added.
          if (userLevel < 3) return [];
          const plugin = pluginMenus.find(({ pluginId, contribution }) => contribution.target.type === 'plugin-route' && pluginSectionId(pluginId, contribution.target.routeId) === section);
          return plugin ? [{ id: section, label: plugin.contribution.label }] : [];
        });
        const grouped = menu.id !== 'chat' && menu.id !== 'my-teams';
        const expanded = !collapsed && (expandedMenus[menu.id] ?? active);
        const count = ['my-workbench', 'chat', 'my-teams'].includes(menu.id) ? countMap[menu.id] ?? 0 : 0;
        const notification = menu.sections.some(section => sectionsWithNotifications.has(section));
        const Icon = menu.icon;
        return (
          <div key={menu.id}>
            <button type="button" aria-label={menu.label} title={collapsed ? menu.label : undefined}
              aria-current={active ? (collapsed || !grouped ? 'page' : 'true') : undefined}
              aria-expanded={grouped ? expanded : undefined} aria-controls={grouped && !collapsed ? `${id}-${menu.id}` : undefined}
              data-nav-section={menu.id} data-nav-group={menu.id}
              onClick={() => {
                if (grouped) {
                  setExpandedMenus(previous => ({ ...previous, [menu.id]: collapsed || !expanded }));
                  if (collapsed) onExpandSidebar?.();
                  return;
                }
                onNavClick(menu.id);
                if (menu.id !== 'chat') return;
                const current = useRoomMetaStore.getState().activeRoomId;
                // ChatSection restores the account's last selection and verifies DM access.
                const room = agentRooms.find(agent => agent.id === current && canOpenConversation(agent));
                if (room) openChatRoom(room.id);
              }}
              className={`relative flex min-h-11 w-full items-center md:min-h-10 gap-2.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary ${collapsed ? 'justify-center px-0' : 'px-3'} ${active && (!grouped || collapsed) ? 'bg-primary/10 text-primary' : active ? 'text-foreground hover:bg-accent' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="truncate">{menu.label}</span>}
              {count > 0 && <span className={`rounded-full bg-primary/10 px-1.5 text-xs text-primary ${collapsed ? 'absolute right-0 top-0' : 'ml-auto'}`}>{count > 99 ? '99+' : count}</span>}
              {notification && !active && count === 0 && <span aria-label="有新动态" className="ml-auto size-2 rounded-full bg-primary" />}
              {grouped && !collapsed && <ChevronDown aria-hidden="true" className={`ml-auto size-4 shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`} />}
            </button>
            {grouped && !collapsed && (
              <div id={`${id}-${menu.id}`} role="group" aria-label={`${menu.label}分类`} hidden={!expanded} className="ml-5 mt-0.5 space-y-0.5 pl-3">
                {items.map(item => (
                  <button key={item.id} type="button" aria-label={item.id === 'humans' ? '用户' : item.label} data-nav-section={item.id} aria-current={activeSection === item.id ? 'page' : undefined}
                    onClick={() => onNavClick(item.id)}
                    className={`flex min-h-11 w-full items-center md:min-h-9 gap-2 rounded-md px-3 text-left text-sm transition-colors focus-visible:outline-2 focus-visible:outline-primary ${activeSection === item.id ? 'bg-primary/10 font-medium text-primary' : 'text-muted-foreground hover:bg-accent hover:text-foreground'}`}>
                    <span>{item.id === 'humans' ? '用户' : item.label}</span>
                    {(countMap[item.id] ?? 0) > 0 && <span className="ml-auto text-xs tabular-nums">{countMap[item.id] > 99 ? '99+' : countMap[item.id]}</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </nav>
  );
}
