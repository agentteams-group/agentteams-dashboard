'use client';

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { Bot, Crown, UserCheck, Users } from 'lucide-react';
import { SectionHeader } from '@/components/dashboard/section-header';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import type { LucideIcon } from 'lucide-react';

const WorkersSection = lazy(() => import('./workers-section').then(m => ({ default: m.WorkersSection })));
const TeamsSection = lazy(() => import('./teams-section').then(m => ({ default: m.TeamsSection })));
const ManagersSection = lazy(() => import('./managers-section').then(m => ({ default: m.ManagersSection })));
const HumansSection = lazy(() => import('./humans-section').then(m => ({ default: m.HumansSection })));

type ResourceTab = 'workers' | 'teams' | 'humans' | 'managers';

interface ResourceTabDef {
  id: ResourceTab;
  label: string;
  icon: LucideIcon;
  /** 管理员可见（与 nav-items 的 minLevel:3 同口径，M19）。 */
  minLevel?: 3;
}

const TABS: ResourceTabDef[] = [
  { id: 'workers', label: 'Workers', icon: Bot },
  { id: 'teams', label: '团队', icon: Users },
  { id: 'humans', label: 'Humans', icon: UserCheck, minLevel: 3 },
  { id: 'managers', label: 'Managers', icon: Crown, minLevel: 3 },
];

/** 从分层 hash 第三段解析初始 tab（#console/resources/humans → humans）。 */
function tabFromHash(): ResourceTab {
  if (typeof window === 'undefined') return 'workers';
  const segments = window.location.hash.slice(1).split('?')[0].split('/').filter(Boolean);
  const last = segments[2];
  return TABS.some((t) => t.id === last) ? (last as ResourceTab) : 'workers';
}

/**
 * Agent 目录（PRD F7.1 资源收敛）：Workers / 团队 / Humans / Managers
 * 收敛为「资源」页二级导航。既有四个 section 组件原样挂载（功能零删减：
 * 技能指派、运行时配置、频道矩阵、工具审批、环境变量全量保留）；
 * 旧深链 #console/resources/<tab> 直达对应 tab。
 */
export function ResourcesSection() {
  const userLevel = useAgentTeamsStore((s) => s.userLevel);
  const [tab, setTab] = useState<ResourceTab>(() => tabFromHash());

  // 外部深链（浏览器前进/后退）跟随：hashchange 时同步 tab。
  useEffect(() => {
    const onHashChange = () => setTab(tabFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);

  // 切换 tab 时同步第三段，保证深链可分享、刷新不丢当前分类；pushState
  // 让浏览器后退可以逐步回退 tab（hashchange 监听负责跟随）。
  const selectTab = (id: ResourceTab) => {
    setTab(id);
    const next = `#console/resources/${id}`;
    if (window.location.hash !== next) {
      window.history.pushState(null, '', next);
    }
  };

  const visibleTabs = useMemo(
    () => TABS.filter((t) => !t.minLevel || userLevel >= t.minLevel),
    [userLevel],
  );

  const activeTab: ResourceTab = visibleTabs.some((t) => t.id === tab) ? tab : 'workers';

  return (
    <div className="space-y-4">
      <SectionHeader
        title="Agent 目录"
        description="人机资源一览 —— Workers、团队、Humans 与 Managers（收敛视图，能力与原页面一致）"
      />

      {/* 二级导航（F7.1） */}
      <div className="flex items-center gap-1 rounded-lg border border-border/60 bg-muted/20 p-1 w-fit" role="tablist" aria-label="资源分类">
        {visibleTabs.map((t) => {
          const Icon = t.icon;
          const active = t.id === activeTab;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => selectTab(t.id)}
              data-resource-tab={t.id}
              className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs transition-colors ${
                active
                  ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 font-medium'
                  : 'text-muted-foreground hover:bg-accent hover:text-foreground'
              }`}
            >
              <Icon className="h-3.5 w-3.5" aria-hidden="true" />
              {t.label}
            </button>
          );
        })}
      </div>

      <Suspense
        fallback={
          <div className="py-16 text-center text-sm text-muted-foreground">加载资源视图…</div>
        }
      >
        {activeTab === 'workers' && <WorkersSection />}
        {activeTab === 'teams' && <TeamsSection />}
        {activeTab === 'humans' && <HumansSection />}
        {activeTab === 'managers' && <ManagersSection />}
      </Suspense>
    </div>
  );
}
