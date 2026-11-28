'use client';

import { useState, useEffect, useRef, useCallback, useMemo, Suspense, lazy } from 'react';
import { useQueryClient } from '@tanstack/react-query';
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
import { useShellPollingSection } from '@/lib/shell-polling';
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
import { QueuedMessagesRunner } from './sections/chat/components/QueuedMessagesRunner';
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
import { isManagedHuman } from './sections/humans/human-selectors';
import { useChatRoomAccess } from '@/hooks/use-chat-room-access';
import { useMatrixStore } from '@/lib/matrix-store';
import { isTeamAdmin } from '@/lib/team-access';
import styles from './workspace.module.css';
import { workspaceMenuFor, workspaceMenus } from './workspace-navigation';
import { isComposing, useDesktopInputFocus } from '@/lib/desktop-interactions';
import { refreshSectionQueries } from '@/lib/section-refresh';

// The settings module (and all of its tabs) is absent until the dialog opens.
const SettingsDialog = lazy(() => import('./settings-dialog').then(m => ({ default: m.SettingsDialog })));

// Lazy load sections for performance
const OverviewSection = lazy(() => import('./sections/overview-section').then(m => ({ default: m.OverviewSection })));
const ResourceCenterSection = lazy(() => import('./sections/resource-center-section').then(m => ({ default: m.ResourceCenterSection })));
const AgentsSection = lazy(() => import('./sections/team-agents/team-agents-section').then(m => ({ default: m.AgentsSection })));
const TeamsSection = lazy(() => import('./sections/team-agents/team-agents-section').then(m => ({ default: m.TeamsSection })));
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

export const sectionMap: Record<string, React.ComponentType> = {
  overview: OverviewSection,
  tasks: TasksSection,
  artifacts: ArtifactsSection,
  'coding-runs': CodingRunsSection,
  loops: LoopsSection,
  resources: AgentsSection,
  'team-agents': TeamsSection,
  workers: AgentsSection,
  skills: ResourceCenterSection,
  teams: TeamsSection,
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

export const pageDescriptions: Record<string, string> = {
  overview: '查看工作区的任务进展、团队和资源概况。',
  chat: '与 AT 助手或你管理团队的团队助手私聊，交代目标并跟进进展。',
  'my-teams': '在已加入的团队群聊中查看协作记录并参与讨论。',
  tasks: '按状态跟进任务，查看子任务、依赖和协作房间。',
  artifacts: '浏览、预览和下载项目任务的交付文件。',
  'coding-runs': '查看编码执行记录、结果和原始日志。',
  loops: '定义、发布和复用自动化流程，查看执行记录。',
  models: '管理模型连接、AI 路由、访问凭证和限流策略。',
  tools: '登记和验证 MCP 服务，管理 Agent 的使用授权。',
  skills: '查看、上传和分发工作区技能。',
  knowledge: '浏览可访问的 Agent 知识库、记忆文件和引用关系。',
  files: '浏览和管理个人文件及团队文件。',
  resources: '查看团队、成员及 Agent 的协作关系。',
  'team-agents': '查看团队成员、协作关系与配置。',
  workers: '管理 Agent，查看运行状态和配置。',
  humans: '管理工作区用户、权限和协作账号。',
  teams: '查看团队成员、协作关系与配置。',
  'platform-assistant-settings': '配置平台助手的模型、提示词、技能与运行参数。',
  'plugin-route:monitor-panel/monitor': '查看 Agent 的资源用量、运行指标和日志。',
  tracing: '查看 Agent 执行链路、耗时、用量和错误。',
  audit: '查询工作区操作记录并跟踪变更。',
};

export function AgentTeamsDashboard() {
  useDesktopInputFocus();
  const queryClient = useQueryClient();
  const { activeSection, setActiveSection } = useActiveSection();
  useShellPollingSection(activeSection);
  const isConversationSection = activeSection === 'chat' || activeSection === 'my-teams';
  const taskCollaboration = useSectionStore((s) => s.taskCollaboration);
  const navigationSection = activeSection === 'chat' && taskCollaboration ? 'tasks' : activeSection;
  const { mode, isLoading: modeLoading } = useDeploymentMode();
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const mobileMenuTriggerRef = useRef<HTMLButtonElement>(null);
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // FUNC-06: subscribe per-field. Matrix sync bumps isSyncing/lastSyncedAt
  // and the connection probe bumps connectionLatency on every poll — a
  // selector-less subscription re-rendered the entire shell (and every
  // section below it) each time.
  const isConnected = useAgentTeamsStore((s) => s.isConnected);
  const openSettings = useAgentTeamsStore((s) => s.openSettings);
  const settingsOpen = useAgentTeamsStore((s) => s.settingsOpen);
  const taskBoardVisible = useAgentTeamsStore((s) => s.taskBoardVisible);
  const userLevel = useAgentTeamsStore((s) => s.userLevel);
  const sessionUser = useAgentTeamsStore((s) => s.sessionUser);
  const matrixUserId = useMatrixStore((s) => s.userId);
  const activeRoomId = useRoomMetaStore((s) => s.activeRoomId);
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
  const agentRooms = useMemo(() => withLeaderAccess(buildRooms([], teams, managers), conversationAccess.joinedRooms, conversationAccess.state).filter((room) => room.access === 'joined' && (room.agentRole === 'leader' ? !!room.team && isTeamAdmin(room.team, sessionUser, matrixUserId) : room.agentRole === 'operations' && userLevel >= 3)), [teams, managers, userLevel, sessionUser, matrixUserId, conversationAccess.joinedRooms, conversationAccess.state]);

  // Plugin system: discover manifests only; entry modules load at their render host.
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
      if (e.isComposing || isComposing()) return;
      const isCmdOrCtrl = e.metaKey || e.ctrlKey;

      if (isCmdOrCtrl) {
        // Ctrl+1..4 follows the four primary destinations.
        if (e.key >= '1' && e.key <= '4') {
          e.preventDefault();
          const index = parseInt(e.key, 10) - 1;
          const destinations = workspaceMenus.filter(menu => menu.id !== 'overview');
          if (index < destinations.length) {
            setActiveSection(destinations[index].id);
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
    : activeItem?.label || '总览';
  const activeMenu = workspaceMenuFor(activeSection);
  const pageDescription = taskCollaboration && activeSection === 'chat'
    ? '跟进任务协作、执行进展与交付内容。'
    : pageDescriptions[activeSection] ?? (isPluginSection
      ? (activePluginRoute?.contribution.description?.trim() || '此页面由已启用的工作区插件提供。')
      : pageDescriptions.overview);

  const workerCount = workers?.length ?? 0;
  const humanCount = useMemo(() => humans?.filter(isManagedHuman).length ?? 0, [humans]);
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
    humans: humanCount,
    teams: teamCount,
    chat: chatCount,
    'my-teams': teamChatCount,
    'my-workbench': workbenchCount,
  }), [workerCount, humanCount, teamCount, chatCount, teamChatCount, workbenchCount]);

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
      await refreshSectionQueries(queryClient, activeSection, activeRoomId);
    } finally {
      setIsRefreshingAll(false);
    }
  }, [queryClient, activeSection, activeRoomId]);

  return (
    <TooltipProvider delayDuration={300}>
      <QueuedMessagesRunner />
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
            onOpenChange={setMobileMenuOpen}
            triggerRef={mobileMenuTriggerRef}
            mode={mode}
          />

          {/* 窄屏底部常驻栏（C-6）：抽屉仍是完整导航，这里只放三个主路径入口。
              搜索项复用已有机制——聚焦顶栏搜索框即打开命令面板（与 ⌘/Ctrl+K 同路）。 */}
          <MobileQuickBar onSearch={() => searchInputRef.current?.focus()} />

          <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden bg-background pb-[calc(3.5rem+env(safe-area-inset-bottom))] md:pb-0">
            <DashboardHeader
              pageLabel={activeLabel}
              groupLabel={activeMenu?.label}
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
              mobileMenuOpen={mobileMenuOpen}
              mobileMenuTriggerRef={mobileMenuTriggerRef}
              onOpenSettings={openSettings}
              mode={mode}
              createActions={visibleCreateActions}
              workers={workers}
              teams={teams}
              managers={managers}
              humans={humans}
            />

            <ConnectionBanner />
            <p data-slot="page-description" className="workspace-content shrink-0 py-3 text-xs leading-5 text-muted-foreground">
              {pageDescription}
            </p>

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
              {isConversationSection ? (
                <div className="flex-1 flex flex-col min-h-0">
                  <SectionErrorBoundary sectionName={activeLabel}>
                    <Suspense fallback={<SectionSkeleton />}>
                      <ChatSection key={activeSection} view={taskCollaboration ? 'all' : activeSection === 'my-teams' ? 'teams' : 'assistants'} />
                    </Suspense>
                  </SectionErrorBoundary>
                </div>
              ) : (
                <main className="workspace-content flex-1 overflow-y-auto custom-scrollbar pt-1 pb-4">
                    <div
                      key={activeSection}
                      className="w-full animate-in fade-in slide-in-from-bottom-1 duration-200"
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
                    </div>
                </main>
              )}
            </div>


          </div>
        </div>

        {settingsOpen && (
          <Suspense fallback={null}>
            <SettingsDialog />
          </Suspense>
        )}
      </div>
    </TooltipProvider>
  );
}
