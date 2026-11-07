'use client';

import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useSectionStore } from '@/lib/section-store';
import { PluginNavItems } from '@/components/plugins/plugin-nav-items';
import { isNavItemVisible, navItems } from '../nav-items';
import { workspaceMenuFor } from '../workspace-navigation';

export function navigateFromSettings(section: string) {
  useAgentTeamsStore.getState().closeSettings();
  useSectionStore.getState().setActiveSection(section);
}

export function ManagementTab() {
  const userLevel = useAgentTeamsStore(state => state.userLevel);
  const activeSection = useSectionStore(state => state.activeSection);
  return <div className="space-y-5">
    <div className="space-y-2">
      <h3 className="text-sm font-medium">运行与治理</h3>
      <p className="text-xs text-muted-foreground">查看系统运行情况与操作记录。</p>
      <div className="flex flex-wrap gap-2">
        {navItems.filter(item => !workspaceMenuFor(item.id) && isNavItemVisible(item, undefined, true, userLevel)).map(item => {
          const Icon = item.icon;
          return <button key={item.id} type="button" onClick={() => navigateFromSettings(item.id)} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">
            <Icon className="size-4" aria-hidden="true" />{item.label}
          </button>;
        })}
      </div>
    </div>
    <PluginNavItems activeSection={activeSection} collapsed={false} onNavClick={navigateFromSettings} />
  </div>;
}
