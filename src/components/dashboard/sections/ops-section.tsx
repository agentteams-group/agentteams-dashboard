'use client';

import { useState } from 'react';
import { Server, Container, HardDrive, FileText, Brain } from 'lucide-react';
import { useDeploymentMode } from '@/hooks/use-deployment-mode';
import { InfrastructureSection } from './infrastructure-section';
import { K8sSection } from './k8s-section';
import { StorageSection } from './storage-section';
import { LogsSection } from './logs-section';
import { ModelsSection } from './models-section';

interface TabDef {
  id: string;
  label: string;
  icon: React.ElementType;
  modes?: ('embedded' | 'k8s')[];
  component: React.ComponentType;
}

const TABS: TabDef[] = [
  { id: 'health', label: '监控', icon: Server, modes: ['k8s'], component: InfrastructureSection },
  { id: 'k8s', label: 'K8s 资源', icon: Container, modes: ['k8s'], component: K8sSection },
  { id: 'storage', label: '存储', icon: HardDrive, modes: ['embedded'], component: StorageSection },
  { id: 'logs', label: '日志', icon: FileText, modes: ['embedded'], component: LogsSection },
  { id: 'models', label: '模型', icon: Brain, modes: ['embedded'], component: ModelsSection },
];

export function OpsSection() {
  const { mode } = useDeploymentMode();
  const visibleTabs = TABS.filter(
    (t) => !t.modes || !mode || t.modes.includes(mode)
  );
  const [activeTab, setActiveTab] = useState(visibleTabs[0]?.id || '');

  // Reset active tab when mode changes and current tab is no longer visible
  // (self-correcting state adjustment during render)
  if (visibleTabs.length > 0 && !visibleTabs.some((t) => t.id === activeTab)) {
    setActiveTab(visibleTabs[0].id);
  }

  const currentTab = visibleTabs.find((t) => t.id === activeTab) || visibleTabs[0];
  const ActiveComponent = currentTab?.component;

  return (
    <div className="flex flex-col h-full min-h-0">
      {/* Tab bar */}
      <div className="shrink-0 border-b border-border px-4 flex items-center gap-1">
        {visibleTabs.map((tab) => {
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
        {ActiveComponent && <ActiveComponent />}
      </div>
    </div>
  );
}
