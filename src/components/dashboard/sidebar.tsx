'use client';

import Image from 'next/image';
import { ChevronLeft, ChevronRight, Settings } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { WorkspaceNavigation } from './workspace-navigation';
import type { DeploymentMode } from './nav-items';
import type { RoomInfo } from './sections/chat/room-info';

interface SidebarProps {
  agentRooms?: RoomInfo[];
  activeSection: string;
  countMap: Record<string, number>;
  sectionsWithNotifications: Set<string>;
  collapsed: boolean;
  onNavClick: (_sectionId: string) => void;
  onToggleCollapse: () => void;
  mode?: DeploymentMode | null;
}

export function Sidebar({ agentRooms, activeSection, countMap, sectionsWithNotifications, collapsed, onNavClick, onToggleCollapse, mode }: SidebarProps) {
  const userLevel = useAgentTeamsStore(state => state.userLevel);
  const openSettings = useAgentTeamsStore(state => state.openSettings);
  return (
    <aside aria-label="主导航" className={`hidden min-h-0 shrink-0 flex-col border-r border-border bg-sidebar md:flex ${collapsed ? 'w-16' : 'w-[232px]'}`}>
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <Image src="/agentteams-logo.svg" alt="AgentTeams" width={28} height={28} className="shrink-0 rounded-lg" />
        {!collapsed && <div className="min-w-0">
          <span className="block text-base font-semibold tracking-tight">AgentTeams</span>
          <span className="text-xs text-muted-foreground">{userLevel >= 3 ? '管理工作区' : '团队工作区'}</span>
        </div>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <WorkspaceNavigation mode={mode} onExpandSidebar={onToggleCollapse} agentRooms={agentRooms} activeSection={activeSection} countMap={countMap} sectionsWithNotifications={sectionsWithNotifications} collapsed={collapsed} onNavClick={onNavClick} />
      </div>
      <div className="space-y-1 border-t border-border p-3">
        <Button variant="ghost" className={`min-h-10 w-full ${collapsed ? 'justify-center' : 'justify-start'}`} onClick={openSettings} aria-label="设置" title={collapsed ? '设置' : undefined}>
          <Settings className="size-4 shrink-0" />{!collapsed && <span>设置</span>}
        </Button>
        <Button variant="ghost" size="sm" className="w-full justify-center" onClick={onToggleCollapse} aria-label={collapsed ? '展开导航' : '收起导航'}>
          {collapsed ? <ChevronRight className="size-4" /> : <ChevronLeft className="size-4" />}
          {!collapsed && <span className="text-xs text-muted-foreground">收起导航</span>}
        </Button>
      </div>
    </aside>
  );
}
