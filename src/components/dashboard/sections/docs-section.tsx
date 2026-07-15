'use client';

import { useState } from 'react';
import { Rocket, GitBranch, Cpu, Shield } from 'lucide-react';
import { QuickstartSection } from './quickstart-section';
import { ArchitectureSection } from './architecture-section';
import { RuntimeSection } from './runtime-section';
import { SecuritySection } from './security-section';

interface TabDef {
  id: string;
  label: string;
  icon: React.ElementType;
  component: React.ComponentType;
}

const TABS: TabDef[] = [
  { id: 'quickstart', label: '快速开始', icon: Rocket, component: QuickstartSection },
  { id: 'architecture', label: '架构', icon: GitBranch, component: ArchitectureSection },
  { id: 'runtime', label: '运行时', icon: Cpu, component: RuntimeSection },
  { id: 'security', label: '安全', icon: Shield, component: SecuritySection },
];

export function DocsSection() {
  const [activeTab, setActiveTab] = useState('quickstart');
  const currentTab = TABS.find((t) => t.id === activeTab) || TABS[0];
  const ActiveComponent = currentTab.component;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tab bar */}
      <div className="shrink-0 border-b border-border px-4 flex items-center gap-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const isActive = tab.id === activeTab;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm transition-colors border-b-2 -mb-px ${
                isActive
                  ? 'border-primary text-primary dark:text-primary font-medium'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-muted-foreground/30'
              }`}
            >
              <Icon className="w-4 h-4" />
              {tab.label}
            </button>
          );
        })}
      </div>

      {/* Tab content */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        <ActiveComponent />
      </div>
    </div>
  );
}
