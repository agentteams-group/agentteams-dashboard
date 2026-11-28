'use client';

import { useEffect, useId, useState } from 'react';
import { Activity, Bot, ChevronDown, Hammer, Home, Library, Settings, Users } from 'lucide-react';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import type { RoomInfo } from './sections/chat/room-info';
import { isNavItemVisible, navItems, type DeploymentMode } from './nav-items';
import { usePluginMenuItems } from '@/lib/plugins/extension-store';
import { pluginSectionId } from '@/lib/plugins/types';

export const OBSERVABILITY_PLUGIN_IDS: readonly string[] = ['monitor-panel'];

export const workspaceMenus = [
  { id: 'overview', label: '首页', icon: Home, sections: ['overview'] },
  { id: 'chat', label: '助手', icon: Bot, sections: ['chat', 'platform-assistant-settings'] },
  { id: 'my-teams', label: '我的团队', icon: Users, sections: ['my-teams'] },
  { id: 'workbench', label: '工作台', icon: Hammer, sections: ['tasks', 'artifacts', 'coding-runs'] },
  { id: 'models', label: '资产中心', icon: Library, sections: ['models', 'tools', 'skills', 'knowledge', 'files'] },
  { id: 'resources', label: '成员与团队', icon: Users, sections: ['resources', 'workers', 'humans', 'teams'] },
  { id: 'tracing', label: '观测与治理', icon: Activity, sections: ['plugin-route:monitor-panel/monitor', 'tracing', 'audit'] },
];

export function workspaceMenuFor(section: string) {
  if (section === 'loops') return { id: 'settings', label: '设置', icon: Settings, sections: ['loops'] };
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

export function WorkspaceNavigation({ activeSection, countMap, sectionsWithNotifications, onNavClick, collapsed, mode, onExpandSidebar }: WorkspaceNavigationProps) {
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
        const grouped = menu.id !== 'chat' && menu.id !== 'my-teams' && menu.id !== 'overview';
        const expanded = !collapsed && (expandedMenus[menu.id] ?? active);
        const count = ['chat', 'my-teams'].includes(menu.id) ? countMap[menu.id] ?? 0 : 0;
        const notification = menu.sections.some(section => sectionsWithNotifications.has(section));
        const Icon = menu.icon;
        return (
          <div key={menu.id}>
            <button type="button" aria-label={menu.label} title={menu.label}
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
              }}
              className={`relative flex h-9 min-h-9 w-full items-center gap-2.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline-1 focus-visible:outline-ring ${collapsed ? 'justify-center px-0' : 'px-3'} ${active && (!grouped || collapsed) ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`}>
              <Icon className="size-4 shrink-0" aria-hidden="true" />
              {!collapsed && <span className="min-w-0 flex-1 truncate text-left">{menu.label}</span>}
              {count > 0 && <span className={`rounded-full bg-primary/10 px-1.5 text-xs text-primary ${collapsed ? 'absolute right-0 top-0' : 'ml-auto'}`}>{count > 99 ? '99+' : count}</span>}
              {notification && !active && count === 0 && <span aria-label="有新动态" className="ml-auto size-2 rounded-full bg-primary" />}
              {grouped && !collapsed && <ChevronDown aria-hidden="true" className={`ml-auto size-4 shrink-0 transition-transform ${expanded ? '' : '-rotate-90'}`} />}
            </button>
            {grouped && !collapsed && (
              <div id={`${id}-${menu.id}`} role="group" aria-label={`${menu.label}分类`} hidden={!expanded} className="ml-5 mt-0.5 space-y-0.5 pl-3">
                {items.map(item => (
                  <button key={item.id} type="button" aria-label={item.id === 'humans' ? '用户' : item.label} data-nav-section={item.id} aria-current={activeSection === item.id ? 'page' : undefined}
                    title={item.id === 'humans' ? '用户' : item.label}
                    onClick={() => onNavClick(item.id)}
                    className={`relative flex h-9 min-h-9 w-full items-center gap-2 rounded-md px-3 text-left text-sm transition-colors focus-visible:outline-1 focus-visible:outline-ring ${activeSection === item.id ? 'bg-sidebar-accent font-medium text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'}`}>
                    <span className="min-w-0 truncate">{item.id === 'humans' ? '用户' : item.label}</span>
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
