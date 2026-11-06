'use client';

import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useAgentTeamsStore } from '@/lib/agentteams-store';

const WorkersSection = lazy(() => import('./workers-section').then(m => ({ default: m.WorkersSection })));
const TeamsSection = lazy(() => import('./teams-section').then(m => ({ default: m.TeamsSection })));
const ManagersSection = lazy(() => import('./managers-section').then(m => ({ default: m.ManagersSection })));
const HumansSection = lazy(() => import('./humans-section').then(m => ({ default: m.HumansSection })));

type ResourceTab = 'workers' | 'teams' | 'humans' | 'managers';

interface ResourceTabDef {
  id: ResourceTab;
  /** 管理员可见（与 nav-items 的 minLevel:3 同口径，M19）。 */
  minLevel?: 3;
}

const TABS: ResourceTabDef[] = [
  { id: 'workers' },
  { id: 'teams' },
  { id: 'humans', minLevel: 3 },
  { id: 'managers', minLevel: 3 },
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
 * 兼容旧资源容器深链；分类导航统一放在左侧。既有 section 原样挂载（功能零删减：
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

  const visibleTabs = useMemo(
    () => TABS.filter((t) => !t.minLevel || userLevel >= t.minLevel),
    [userLevel],
  );

  const activeTab: ResourceTab = visibleTabs.some((t) => t.id === tab) ? tab : 'workers';

  return (
    <div className="space-y-4">
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
