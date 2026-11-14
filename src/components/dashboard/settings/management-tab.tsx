'use client';

import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useSectionStore } from '@/lib/section-store';
import { PluginNavItems } from '@/components/plugins/plugin-nav-items';
import { OBSERVABILITY_PLUGIN_IDS, workspaceMenuFor } from '../workspace-navigation';
import { navItems, isNavItemVisible } from '../nav-items';

export function navigateFromSettings(section: string) {
  useAgentTeamsStore.getState().closeSettings();
  useSectionStore.getState().setActiveSection(section);
}

export function ManagementTab() {
  const userLevel = useAgentTeamsStore(state => state.userLevel);
  const activeSection = useSectionStore(state => state.activeSection);
  return <div className="space-y-5">
    <div className="space-y-2">
      <h3 className="text-sm font-medium">管理入口</h3>
      <p className="text-xs text-muted-foreground">监控、Tracing 与操作审计已移至左侧「观测与治理」。</p>
      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={() => navigateFromSettings('tracing')} className="flex min-h-11 items-center gap-2 rounded-lg border border-border px-4 text-sm hover:bg-muted focus-visible:outline-2 focus-visible:outline-primary">打开观测与治理</button>
        {navItems.filter(item => !workspaceMenuFor(item.id) && isNavItemVisible(item, undefined, true, userLevel)).map(item => <button key={item.id} type="button" onClick={() => navigateFromSettings(item.id)} className="flex min-h-11 items-center rounded-lg border px-4 text-sm hover:bg-muted">{item.label}</button>)}
      </div>
    </div>
    <PluginNavItems activeSection={activeSection} collapsed={false} onNavClick={navigateFromSettings} excludePluginIds={OBSERVABILITY_PLUGIN_IDS} />
  </div>;
}
