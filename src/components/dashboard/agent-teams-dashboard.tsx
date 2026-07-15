'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Home,
  ChevronRight as ChevronSep,
} from 'lucide-react';
import {
  TooltipProvider,
} from '@/components/ui/tooltip';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { useNotificationStore } from '@/lib/notification-store';
import { useSearch } from '@/lib/search-context';
import { useAgentTeamsStatus } from '@/hooks/use-agentteams-status';
import { useVersion } from '@/hooks/use-agentteams-version';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { ConnectionBanner } from './connection-banner';
import { SettingsDialog } from './settings-dialog';
import { SectionErrorBoundary } from './section-error-boundary';
import { SectionSkeleton } from './section-skeleton';
import { Sidebar } from './sidebar';
import { MobileSidebar } from './mobile-sidebar';
import { DashboardHeader } from './header';
import { DashboardFooter } from './footer';
import { useActiveSection } from './use-active-section';
import { navItems, isNavItemVisible, createActions, isCreateActionVisible } from './nav-items';
import { useDeploymentMode } from '@/hooks/use-deployment-mode';
import { useEnsureAiGateway } from '@/hooks/use-ensure-ai-gateway';
import { usePhaseWatcher } from '@/hooks/use-phase-watcher';

// Lazy load sections for performance
const OverviewSection = lazy(() => import('./sections/overview-section').then(m => ({ default: m.OverviewSection })));
const WorkersSection = lazy(() => import('./sections/workers-section').then(m => ({ default: m.WorkersSection })));
const TeamsSection = lazy(() => import('./sections/teams-section').then(m => ({ default: m.TeamsSection })));
const ManagersSection = lazy(() => import('./sections/managers-section').then(m => ({ default: m.ManagersSection })));
const HumansSection = lazy(() => import('./sections/humans-section').then(m => ({ default: m.HumansSection })));
const ChatSection = lazy(() => import('./sections/chat-section').then(m => ({ default: m.ChatSection })));
const OpsSection = lazy(() => import('./sections/ops-section').then(m => ({ default: m.OpsSection })));
const DocsSection = lazy(() => import('./sections/docs-section').then(m => ({ default: m.DocsSection })));
const PoliciesSection = lazy(() => import('./sections/policies-section').then(m => ({ default: m.PoliciesSection })));
const GatewaySection = lazy(() => import('./sections/gateway-section').then(m => ({ default: m.GatewaySection })));
const TopologySection = lazy(() => import('./sections/topology-section').then(m => ({ default: m.TopologySection })));
const SandboxSection = lazy(() => import('./sections/sandbox-section').then(m => ({ default: m.SandboxSection })));
const ComplianceSection = lazy(() => import('./sections/compliance-section').then(m => ({ default: m.ComplianceSection })));

const sectionMap: Record<string, React.ComponentType> = {
  overview: OverviewSection,
  workers: WorkersSection,
  teams: TeamsSection,
  managers: ManagersSection,
  humans: HumansSection,
  chat: ChatSection,
  topology: TopologySection,
  gateway: GatewaySection,
  policies: PoliciesSection,
  sandbox: SandboxSection,
  compliance: ComplianceSection,
  ops: OpsSection,
  docs: DocsSection,
};

export function AgentTeamsDashboard() {
  const queryClient = useQueryClient();
  const { activeSection, setActiveSection } = useActiveSection();
  const { mode, isLoading: modeLoading } = useDeploymentMode();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const { isConnected, openSettings, controllerUrl, connectionLatency, reconnectInterval } = useAgentTeamsStore();
  const { isLoggedIn: matrixLoggedIn, isSyncing: matrixSyncing } = useMatrixStore();
  const notifications = useNotificationStore((s) => s.notifications);
  const { searchQuery, setSearchQuery } = useSearch();
  const { data: versionData } = useVersion();

  // Auto-configure Higress AI gateway on first load
  useEnsureAiGateway();
  usePhaseWatcher();
  useAgentTeamsStatus();
  const { data: workers } = useWorkers();
  const { data: teams } = useTeams();
  const { data: managers } = useManagers();
  const { data: humans } = useHumans();
  const [lastRefreshTime, setLastRefreshTime] = useState<Date>(new Date());

  const visibleNavItems = useMemo(
    () => navItems.filter((item) => isNavItemVisible(item, mode)),
    [mode]
  );

  const visibleCreateActions = useMemo(
    () => createActions.filter((action) => isCreateActionVisible(action, mode)),
    [mode]
  );

  const checkConnection = useAgentTeamsStore((s) => s.checkConnection);
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // Track the last time entity data changed (adjust state during render)
  const [prevData, setPrevData] = useState({ workers, teams, managers });
  if (prevData.workers !== workers || prevData.teams !== teams || prevData.managers !== managers) {
    setPrevData({ workers, teams, managers });
    if (workers !== undefined || teams !== undefined || managers !== undefined) {
      setLastRefreshTime(new Date());
    }
  }

  // Guard active section: fall back to overview if the current section is hidden in this mode.
  useEffect(() => {
    if (!modeLoading && !visibleNavItems.some((n) => n.id === activeSection)) {
      setActiveSection('overview');
    }
  }, [activeSection, visibleNavItems, setActiveSection, modeLoading]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;
      if (isCmdOrCtrl && e.key >= '1' && e.key <= '9') {
        e.preventDefault();
        const index = parseInt(e.key, 10) - 1;
        if (index < visibleNavItems.length) {
          setActiveSection(visibleNavItems[index].id);
          setMobileMenuOpen(false);
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveSection, visibleNavItems]);

  const ActiveSectionComponent = sectionMap[activeSection] || OverviewSection;
  const activeLabel = visibleNavItems.find((n) => n.id === activeSection)?.label || '总览';

  const workerCount = workers?.length ?? 0;
  const teamCount = teams?.length ?? 0;
  const managerCount = managers?.length ?? 0;

  const countMap: Record<string, number> = useMemo(() => ({
    workers: workerCount,
    teams: teamCount,
    managers: managerCount,
  }), [workerCount, teamCount, managerCount]);

  const sectionsWithNotifications = useMemo(() => {
    const sectionSet = new Set<string>();
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    notifications.forEach((n) => {
      if (!n.read && n.timestamp > fiveMinutesAgo) {
        const msg = (n.title + ' ' + n.message).toLowerCase();
        if (msg.includes('worker')) sectionSet.add('workers');
        if (msg.includes('团队') || msg.includes('team')) sectionSet.add('teams');
        if (msg.includes('manager')) sectionSet.add('managers');
        if (msg.includes('matrix') || msg.includes('聊天') || msg.includes('chat')) sectionSet.add('chat');
        if (msg.includes('infra') || msg.includes('基础设施')) sectionSet.add('ops');
        if (msg.includes('k8s') || msg.includes('kubernetes')) sectionSet.add('ops');
      }
    });
    return sectionSet;
  }, [notifications]);

  const latencyText = connectionLatency != null ? `${connectionLatency}ms` : '--';
  const latencyColor = connectionLatency != null
    ? connectionLatency < 100 ? 'text-emerald-500'
    : connectionLatency < 300 ? 'text-amber-500'
    : 'text-red-500'
    : 'text-muted-foreground';

  const lastRefreshText = (() => {
    const now = Date.now();
    const diff = now - lastRefreshTime.getTime();
    if (diff < 5000) return '刚刚';
    if (diff < 60000) return `${Math.floor(diff / 1000)}秒前`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    return lastRefreshTime.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
  })();

  const handleNavClick = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    setMobileMenuOpen(false);
  }, [setActiveSection]);

  const handleRefreshAll = useCallback(async () => {
    setIsRefreshingAll(true);
    try {
      await queryClient.invalidateQueries({ queryKey: ['agentteams'] });
      await queryClient.invalidateQueries({ queryKey: ['matrix'] });
      setLastRefreshTime(new Date());
    } finally {
      setIsRefreshingAll(false);
    }
  }, [queryClient]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className="min-h-screen flex flex-col bg-background">
        <div className="flex flex-1 min-h-0">
          <Sidebar
            activeSection={activeSection}
            countMap={countMap}
            sectionsWithNotifications={sectionsWithNotifications}
            collapsed={sidebarCollapsed}
            onNavClick={handleNavClick}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            mode={mode}
          />

          <MobileSidebar
            open={mobileMenuOpen}
            activeSection={activeSection}
            countMap={countMap}
            sectionsWithNotifications={sectionsWithNotifications}
            onNavClick={handleNavClick}
            onClose={() => setMobileMenuOpen(false)}
            mode={mode}
          />

          <div className="flex-1 flex flex-col min-w-0">
            <DashboardHeader
              isConnected={isConnected}
              workerCount={workerCount}
              teamCount={teamCount}
              managerCount={managerCount}
              versionString={versionData?.controller}
              isRefreshingAll={isRefreshingAll}
              searchQuery={searchQuery}
              searchInputRef={searchInputRef}
              onSearchChange={setSearchQuery}
              onNavClick={handleNavClick}
              onRefreshAll={handleRefreshAll}
              onOpenMobileMenu={() => setMobileMenuOpen(true)}
              onOpenSettings={openSettings}
              mode={mode}
              createActions={visibleCreateActions}
              workers={workers}
              teams={teams}
              managers={managers}
              humans={humans}
            />

            <ConnectionBanner />

            {activeSection === 'chat' ? (
              /* Chat mode: bypass <main> scroll container, fill all available space */
              <div className="flex-1 flex flex-col min-h-0">
                <Suspense fallback={<SectionSkeleton />}>
                  <ChatSection />
                </Suspense>
              </div>
            ) : (
              /* Normal mode: breadcrumb + scrollable content + footer */
              <>
                <div className="px-4 md:px-6 py-2 border-b border-border/50 bg-background/50">
                  <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Home className="w-3.5 h-3.5" />
                    <ChevronSep className="w-3 h-3" />
                    <span className="font-medium text-foreground">AgentTeams</span>
                    <ChevronSep className="w-3 h-3" />
                    <span>{activeLabel}</span>
                  </nav>
                </div>

                <main className="flex-1 overflow-y-auto custom-scrollbar p-4 md:p-6">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={activeSection}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                    >
                      <SectionErrorBoundary sectionName={activeLabel}>
                        <Suspense fallback={<SectionSkeleton />}>
                          <ActiveSectionComponent />
                        </Suspense>
                      </SectionErrorBoundary>
                    </motion.div>
                  </AnimatePresence>
                </main>

                <DashboardFooter
                  isConnected={isConnected}
                  connectionLatency={connectionLatency}
                  controllerUrl={controllerUrl}
                  reconnectInterval={reconnectInterval}
                  lastRefreshText={lastRefreshText}
                  latencyColor={latencyColor}
                  latencyText={latencyText}
                  matrixLoggedIn={matrixLoggedIn}
                  matrixSyncing={matrixSyncing}
                />
              </>
            )}
          </div>
        </div>

        <SettingsDialog />
      </div>
    </TooltipProvider>
  );
}
