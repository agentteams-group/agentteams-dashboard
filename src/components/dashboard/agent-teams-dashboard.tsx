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
import { useSectionStore } from '@/lib/section-store';
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
import { MobileQuickBar } from './mobile-quick-bar';
import { DashboardHeader } from './header';
import { useActiveSection } from './use-active-section';
import {
  navItems,
  isNavItemVisible,
  createActions,
  isCreateActionVisible,
} from './nav-items';
import { useDeploymentMode } from '@/hooks/use-deployment-mode';
import { usePhaseWatcher } from '@/hooks/use-phase-watcher';
import { useGlobalMatrixSync } from '@/hooks/use-global-matrix-sync';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { useInviteStore } from '@/lib/matrix-invite-store';
import { usePendingTally } from '@/hooks/use-pending-tally';
import { usePluginSystem } from '@/hooks/use-plugin-system';
import { PluginRouteView } from '@/components/plugins/plugin-route-view';
import { usePluginRoutes } from '@/lib/plugins/extension-store';
import { usePluginRegistry } from '@/lib/plugins/registry';
import {
  isPluginSectionId,
  parsePluginSectionId,
} from '@/lib/plugins/types';
import { pluginEventBus, HOST_EVENTS } from '@/lib/plugins/event-bus';
import { buildRooms } from './sections/chat/room-builders';
import { withLeaderAccess } from './sections/chat/agent-conversations';
import { useChatRoomAccess } from '@/hooks/use-chat-room-access';
import styles from './workspace.module.css';
import { workspaceMenuFor, workspaceMenus } from './workspace-navigation';

// Lazy load sections for performance
const OverviewSection = lazy(() => import('./sections/overview-section').then(m => ({ default: m.OverviewSection })));
const ResourceCenterSection = lazy(() => import('./sections/resource-center-section').then(m => ({ default: m.ResourceCenterSection })));
const AgentsSection = lazy(() => import('./sections/team-agents/team-agents-section').then(m => ({ default: m.AgentsSection })));
const TeamsSection = lazy(() => import('./sections/team-agents/team-agents-section').then(m => ({ default: m.TeamsSection })));
const ManagersSection = lazy(() => import('./sections/managers-section').then(m => ({ default: m.ManagersSection })));
const PlatformAssistantSettingsSection = lazy(() => import('./sections/platform-assistant-settings-section').then(m => ({ default: m.PlatformAssistantSettingsSection })));
const HumansSection = lazy(() => import('./sections/humans-section').then(m => ({ default: m.HumansSection })));
const ModelsSection = lazy(() => import('./sections/models-section').then(m => ({ default: m.ModelsSection })));
const ChatSection = lazy(() => import('./sections/chat/ChatSection').then(m => ({ default: m.ChatSection })));
const TasksSection = lazy(() => import('./sections/tasks-section').then(m => ({ default: m.TasksSection })));
const ArtifactsSection = lazy(() => import('./sections/artifacts-section').then(m => ({ default: m.ArtifactsSection })));
const CodingRunsSection = lazy(() => import('./sections/coding-runs-section').then(m => ({ default: m.CodingRunsSection })));
const LoopsSection = lazy(() => import('./sections/loops-section').then(m => ({ default: m.LoopsSection })));
const AuditSection = lazy(() => import('./sections/audit-section').then(m => ({ default: m.AuditSection })));
const TracingSection = lazy(() => import('./sections/tracing-section').then(m => ({ default: m.TracingSection })));
const KnowledgeSection = lazy(() => import('./sections/knowledge-section').then(m => ({ default: m.KnowledgeSection })));
const FilesSection = lazy(() => import('./sections/files-section').then(m => ({ default: m.FilesSection })));
const McpServersSection = lazy(() => import('./sections/mcps/mcp-servers-section').then(m => ({ default: m.McpServersSection })));

// A5：四个工作台 id（resources / team-agents / workers / teams）统一挂
// TeamsSection——旧代码里 workers 走 AgentsSection、其余走 TeamsSection，
// 组件类型 + motion key 都不同，shell 的 hashchange 在 resolved id 间
// 切换（agent 参数 → 'workers'，其余 → 'teams'）会触发 AnimatePresence
// 重挂载闪烁。同类型 + 同 key = 状态不丢、不闪。
export const sectionMap: Record<string, React.ComponentType> = {
  overview: OverviewSection,
  tasks: TasksSection,
  artifacts: ArtifactsSection,
  'coding-runs': CodingRunsSection,
  loops: LoopsSection,
  resources: TeamsSection,
  'team-agents': TeamsSection,
  workers: TeamsSection,
  skills: ResourceCenterSection,
  teams: TeamsSection,
  managers: ManagersSection,
  'platform-assistant-settings': PlatformAssistantSettingsSection,
  humans: HumansSection,
  models: ModelsSection,
  tools: McpServersSection,
  knowledge: KnowledgeSection,
  files: FilesSection,
  audit: AuditSection,
  tracing: TracingSection,
  chat: ChatSection,
  'my-teams': ChatSection,
};

export function AgentTeamsDashboard() {
  const queryClient = useQueryClient();
  const { activeSection, setActiveSection } = useActiveSection();
  const isConversationSection = activeSection === 'chat' || activeSection === 'my-teams';
  const taskCollaboration = useSectionStore((s) => s.taskCollaboration);
  const navigationSection = activeSection === 'chat' && taskCollaboration ? 'tasks' : activeSection;
  const { mode, isLoading: modeLoading } = useDeploymentMode();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // FUNC-06: subscribe per-field. Matrix sync bumps isSyncing/lastSyncedAt
  // and the connection probe bumps connectionLatency on every poll — a
  // selector-less subscription re-rendered the entire shell (and every
  // section below it) each time.
  const isConnected = useAgentTeamsStore((s) => s.isConnected);
  const openSettings = useAgentTeamsStore((s) => s.openSettings);
  const taskBoardVisible = useAgentTeamsStore((s) => s.taskBoardVisible);
  const userLevel = useAgentTeamsStore((s) => s.userLevel);
  const sessionUser = useAgentTeamsStore((s) => s.sessionUser);
  const notifications = useNotificationStore((s) => s.notifications);
  const { searchQuery, setSearchQuery } = useSearch();
  const { data: versionData } = useVersion();
  usePhaseWatcher();
  useAgentTeamsStatus();
  // Single global Matrix sync loop: keeps the task panel populated, the chat
  // sidebar meta fresh (lastMessageTs + unread counts) and typing/receipt
  // indicators live, regardless of which section is active. Room switches no
  // longer restart the loop, so the sync token survives across them.
  useGlobalMatrixSync();
  const { data: workers } = useWorkers();
  const { data: teams } = useTeams();
  const { data: managers } = useManagers();
  const { data: humans } = useHumans();
  const conversationAccess = useChatRoomAccess();
  const agentRooms = useMemo(() => withLeaderAccess(buildRooms([], teams, managers), conversationAccess.joinedRooms, conversationAccess.state).filter((room) => room.access === 'joined' && (room.agentRole === 'leader' ? room.team?.admin ? room.team.admin.name === sessionUser : userLevel >= 3 : room.agentRole === 'operations' && userLevel >= 3)), [teams, managers, userLevel, sessionUser, conversationAccess.joinedRooms, conversationAccess.state]);

  // Plugin system: discover + activate plugins once per session.
  usePluginSystem();
  const pluginRoutes = usePluginRoutes();
  const pluginsReady = usePluginRegistry((s) => s.ready);
  const isPluginSection = isPluginSectionId(activeSection);

  const visibleNavItems = useMemo(
    () => navItems.filter((item) => isNavItemVisible(item, mode, taskBoardVisible, userLevel)),
    [mode, taskBoardVisible, userLevel]
  );

  const visibleCreateActions = useMemo(
    () => createActions.filter((action) => isCreateActionVisible(action, mode, taskBoardVisible, userLevel)),
    [mode, taskBoardVisible, userLevel]
  );

  const checkConnection = useAgentTeamsStore((s) => s.checkConnection);
  useEffect(() => {
    checkConnection();
  }, [checkConnection]);

  // Guard active section: fall back to overview if the current section is
  // hidden in this mode or points at a plugin route that no longer exists.
  useEffect(() => {
    if (modeLoading) return;
    if (isPluginSection) {
      // Wait for plugin discovery to finish before judging the route missing.
      if (!pluginsReady) return;
      const parsed = parsePluginSectionId(activeSection);
      const exists =
        parsed !== null &&
        pluginRoutes.some(
          (r) => r.pluginId === parsed.pluginId && r.contribution.id === parsed.routeId
        );
      if (!exists) setActiveSection('overview');
      return;
    }
    if (!visibleNavItems.some((n) => n.id === activeSection)) {
      // A5：'workers' / 'teams' 已并入 'team-agents' 导航项（navItems 里
      // 不再有这两个 id），但 hash 解析（旧链接 / 搜索深链）仍会落到它们
      // 上面——豁免守卫，不能把它们弹回 overview（否则搜索深链跳首页）。
      if (activeSection === 'workers' || activeSection === 'teams') return;
      // Flag-hidden sections (taskBoard beta toggle) keep their route
      // reachable per the agentteams-store contract: "hidden = the nav item
      // is removed, the section route still works if navigated to directly".
      // The projects section was merged into tasks (use-active-section
      // aliases #projects -> #tasks), so it never reaches this check.
      // Mode-hidden, unknown or privileged sections fall back; flag-hidden routes remain reachable.
      const known = navItems.find((n) => n.id === activeSection);
      const modeHidden = !known || (!!known.modes && !!mode && !known.modes.includes(mode));
      const levelHidden = !!known?.minLevel && userLevel < known.minLevel;
      if (modeHidden || levelHidden) {
        setActiveSection(levelHidden ? 'workers' : 'overview');
      }
    }
  }, [activeSection, visibleNavItems, setActiveSection, mode, modeLoading, isPluginSection, pluginsReady, pluginRoutes, userLevel]);

  // Notify plugins about section changes (host:section-changed).
  useEffect(() => {
    pluginEventBus.emit(HOST_EVENTS.sectionChanged, { sectionId: activeSection });
  }, [activeSection]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      if (isCmdOrCtrl) {
        // Ctrl+1..4 follows the four primary destinations.
        if (e.key >= '1' && e.key <= '4') {
          e.preventDefault();
          const index = parseInt(e.key, 10) - 1;
          if (index < workspaceMenus.length) {
            setActiveSection(workspaceMenus[index].id);
            setMobileMenuOpen(false);
          }
        }
        return;
      }

      const focusedElement = document.activeElement;
      if (!(focusedElement instanceof HTMLElement)) return;

      const focusedSection = focusedElement.dataset.navSection;
      if (!focusedSection) return;

      if (e.key === 'Enter' && focusedSection) {
        e.preventDefault();
        focusedElement.click();
        return;
      }

      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;

      const buttons = Array.from(focusedElement.closest('aside')?.querySelectorAll<HTMLButtonElement>('[data-nav-section]') ?? [])
        .filter(button => !button.closest('[hidden]'));
      const currentIndex = buttons.indexOf(focusedElement as HTMLButtonElement);
      const nextIndex = currentIndex + (e.key === 'ArrowDown' ? 1 : -1);
      if (currentIndex < 0 || nextIndex < 0 || nextIndex >= buttons.length) return;
      const target = buttons[nextIndex];
      if (target) {
        e.preventDefault();
        target.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [setActiveSection]);

  const activeItem = navItems.find((n) => n.id === activeSection);
  const ActiveSectionComponent = activeItem?.minLevel && userLevel < activeItem.minLevel
    ? AgentsSection
    : sectionMap[activeSection] || OverviewSection;
  // A5：四个工作台 id 合并后的 resolved id（workers / teams / resources）
  // 没有独立导航项——面包屑回落「团队与Agent」标签，避免显示「总览」。
  const isWorkbenchMerged =
    activeSection === 'workers' || activeSection === 'teams' || activeSection === 'resources';
  // A5：四个工作台 id 共享同一个 motion key（与 sectionMap 的组件统一配套）
  // ——resolved id 在 'workers' ↔ 'teams' 间切换时不重挂载、不闪。
  const sectionMotionKey = isWorkbenchMerged || activeSection === 'team-agents' ? 'workbench' : activeSection;
  const activePluginRoute = useMemo(() => {
    const parsed = parsePluginSectionId(activeSection);
    if (!parsed) return null;
    return (
      pluginRoutes.find(
        (r) => r.pluginId === parsed.pluginId && r.contribution.id === parsed.routeId
      ) ?? null
    );
  }, [activeSection, pluginRoutes]);
  const activeLabel = isPluginSection
    ? activePluginRoute?.contribution.title ?? '插件页面'
    : activeItem?.label ?? (isWorkbenchMerged ? navItems.find((n) => n.id === 'team-agents')?.label : undefined) ?? '总览';
  const activeMenu = workspaceMenuFor(activeSection);

  const workerCount = workers?.length ?? 0;
  const teamCount = teams?.length ?? 0;
  const managerCount = managers?.length ?? 0;
  const roomMeta = useRoomMetaStore((s) => s.meta);
  const unreadRoomCount = useMemo(
    () => agentRooms.filter(room => (roomMeta[room.id]?.unreadCount ?? 0) > 0).length,
    [roomMeta, agentRooms],
  );
  const invitePending = useInviteStore((s) => s.invites);
  const inviteCount = Object.keys(invitePending).length;
  const chatCount = unreadRoomCount;
  const teamChatCount = (teams ?? []).filter(team => conversationAccess.joinedRooms?.includes(team.teamRoomID) && (roomMeta[team.teamRoomID]?.unreadCount ?? 0) > 0).length + inviteCount;
  // 「等我」徽标走统一口径（C-1），与待办横幅、我的工作台同一个数。
  const workbenchCount = usePendingTally().total;

  const countMap: Record<string, number> = useMemo(() => ({
    workers: workerCount,
    teams: teamCount,
    chat: chatCount,
    'my-teams': teamChatCount,
    'my-workbench': workbenchCount,
  }), [workerCount, teamCount, chatCount, teamChatCount, workbenchCount]);

  const sectionsWithNotifications = useMemo(() => {
    const sectionSet = new Set<string>();
    const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
    notifications.forEach((n) => {
      if (!n.read && n.timestamp > fiveMinutesAgo) {
        const msg = (n.title + ' ' + n.message).toLowerCase();
        if (msg.includes('worker')) sectionSet.add('workers');
        if (msg.includes('团队') || msg.includes('team')) sectionSet.add('teams');
        if (msg.includes('manager')) sectionSet.add('chat');
        if (msg.includes('matrix') || msg.includes('聊天') || msg.includes('chat')) sectionSet.add('chat');
        if (msg.includes('infra') || msg.includes('基础设施')) { /* ops section removed */ }
        if (msg.includes('k8s') || msg.includes('kubernetes')) { /* ops section removed */ }
      }
    });
    return sectionSet;
  }, [notifications]);

  const handleNavClick = useCallback((sectionId: string) => {
    setActiveSection(sectionId);
    setMobileMenuOpen(false);
  }, [setActiveSection]);

  const handleRefreshAll = useCallback(async () => {
    setIsRefreshingAll(true);
    try {
      // Query keys are flat strings ('agentteams-workers', 'matrix-messages', ...),
      // so a key-prefix invalidate never matches. Use a predicate to invalidate
      // every agentteams/matrix query, including parameterized keys.
      await queryClient.invalidateQueries({
        predicate: (query) => {
          const first = query.queryKey[0];
          return (
            typeof first === 'string' &&
            (first.startsWith('agentteams-') || first.startsWith('matrix-'))
          );
        },
      });
    } finally {
      setIsRefreshingAll(false);
    }
  }, [queryClient]);

  return (
    <TooltipProvider delayDuration={300}>
      <div className={`${styles.workspace} h-dvh overflow-hidden flex flex-col bg-background`}>
        <div className="flex flex-1 min-h-0">
          <Sidebar
            agentRooms={agentRooms}
            activeSection={navigationSection}
            countMap={countMap}
            sectionsWithNotifications={sectionsWithNotifications}
            collapsed={sidebarCollapsed}
            onNavClick={handleNavClick}
            onToggleCollapse={() => setSidebarCollapsed(!sidebarCollapsed)}
            mode={mode}
          />

          <MobileSidebar
            agentRooms={agentRooms}
            open={mobileMenuOpen}
            activeSection={navigationSection}
            countMap={countMap}
            sectionsWithNotifications={sectionsWithNotifications}
            onNavClick={handleNavClick}
            onClose={() => setMobileMenuOpen(false)}
            mode={mode}
          />

          {/* 窄屏底部常驻栏（C-6）：抽屉仍是完整导航，这里只放三个主路径入口。
              搜索项复用已有机制——聚焦顶栏搜索框即打开命令面板（与 ⌘/Ctrl+K 同路）。 */}
          <MobileQuickBar onSearch={() => searchInputRef.current?.focus()} />

          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-background pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
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

            {/*
              Single tree for every section. The chat layout only differs in
              that it bypasses the breadcrumb + scrollable <main> wrapper and
              fills the whole column — toggling visibility is cheaper than
              branching the JSX, and avoids the AnimatePresence branch-swap
              trap where switching between chat (no AnimatePresence children)
              and any other section (one AnimatePresence child) used to skip
              the entrance animation and sometimes left the new section
              invisible (operator saw "click 任务看板 first time does
              nothing").
            */}
            <div
              className={`flex-1 flex flex-col min-h-0 ${isConversationSection ? '' : 'bg-background'}`}
            >
              {!isConversationSection && (
                <div className="px-5 py-3 md:px-6 bg-background">
                  <nav className="flex items-center gap-1.5 text-sm text-muted-foreground">
                    <Home className="w-3.5 h-3.5" />
                    <ChevronSep className="w-3 h-3" />
                    <span className="font-medium text-foreground">AgentTeams</span>
                    <ChevronSep className="w-3 h-3" />
                    {activeMenu && activeMenu.label !== activeLabel && <><span>{activeMenu.label}</span><ChevronSep className="w-3 h-3" /></>}
                    <span>{activeLabel}</span>
                  </nav>
                </div>
              )}

              {isConversationSection ? (
                <div className="flex-1 flex flex-col min-h-0">
                  <SectionErrorBoundary sectionName={activeLabel}>
                    <Suspense fallback={<SectionSkeleton />}>
                      <ChatSection key={activeSection} view={taskCollaboration ? 'all' : activeSection === 'my-teams' ? 'teams' : 'assistants'} />
                    </Suspense>
                  </SectionErrorBoundary>
                </div>
              ) : (
                <main className="flex-1 overflow-y-auto custom-scrollbar p-5 md:px-6 md:pb-6 md:pt-3">
                  <AnimatePresence mode="wait">
                    <motion.div
                      key={sectionMotionKey}
                      className="mx-auto w-full max-w-[1760px]"
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -8 }}
                      transition={{ duration: 0.2 }}
                    >
                      <SectionErrorBoundary sectionName={activeLabel}>
                        <Suspense fallback={<SectionSkeleton />}>
                          {isPluginSection ? (
                            <PluginRouteView sectionId={activeSection} />
                          ) : (
                            <ActiveSectionComponent />
                          )}
                        </Suspense>
                      </SectionErrorBoundary>
                    </motion.div>
                  </AnimatePresence>
                </main>
              )}
            </div>


          </div>
        </div>

        <SettingsDialog />
      </div>
    </TooltipProvider>
  );
}
