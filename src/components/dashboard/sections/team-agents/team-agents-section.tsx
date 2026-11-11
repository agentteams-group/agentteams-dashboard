'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Bot,
  ChevronRight,
  Plus,
  Settings,
  Users,
} from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { SectionHeader } from '@/components/dashboard/section-header';
import { StatusDot } from '@/components/dashboard/status-dot';
import { useCreateTeam, useCreateWorker } from '@/hooks/use-agentteams-mutations';
import { useModelSelection } from '@/hooks/use-model-selection';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useSearch } from '@/lib/search-context';
import { hashForSection } from '@/lib/nav-hash';
import type {
  CreateTeamRequest,
  CreateWorkerRequest,
  TeamResponse,
  WorkerResponse,
} from '@/lib/agentteams-api';
import { TeamCreateDialog } from '../teams/team-create-dialog';
import { TeamDrawer } from '../teams/team-drawer';
import { WorkerCreateDialog } from '../workers/worker-create-dialog';
import { WorkerDrawer } from '../workers/worker-drawer';
import { InteractiveTeamTopology } from './interactive-team-topology';
import {
  ROLE_LABELS,
  filterTeamRows,
  filterWorkerRows,
  isAbnormalPhase,
  layoutForWidth,
  memberRole,
  memberSessionCount,
  shellGridClass,
  teamAgentsTabFromHash,
  type TeamAgentMember,
  type TeamAgentRow,
  type TeamAgentsLayout,
  type TeamAgentsTab,
} from './team-agents-logic';

const TEAM_AGENTS_HASH = hashForSection('team-agents');

const EMPTY_TEAM: CreateTeamRequest = { name: '', leader: { name: '' }, workerNames: [] };
const EMPTY_WORKER: CreateWorkerRequest = { name: '', runtime: 'openclaw' };

function useTeamAgentsLayout(): TeamAgentsLayout {
  // SSR 首帧固定 wide（服务端/客户端一致），挂载后按真实宽度切换。
  const [layout, setLayout] = useState<TeamAgentsLayout>('wide');
  useEffect(() => {
    const sync = () => setLayout(layoutForWidth(window.innerWidth));
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, []);
  return layout;
}

function Pane({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <section
      aria-label={label}
      className={`flex min-h-0 min-w-0 flex-col overflow-hidden rounded-lg border bg-card ${className}`}
    >
      {children}
    </section>
  );
}

function PaneHeader({ title, meta }: { title: string; meta?: string }) {
  return (
    <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
      <h2 className="truncate text-sm font-semibold">{title}</h2>
      {meta && <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{meta}</span>}
    </div>
  );
}

function TeamListRow({
  row,
  selected,
  onSelect,
  onOpenSettings,
}: {
  row: TeamAgentRow;
  selected: boolean;
  onSelect: (_team: TeamResponse) => void;
  onOpenSettings: (_team: TeamResponse) => void;
}) {
  const { team, matchedMembers } = row;
  return (
    <li className="flex min-w-0 items-center gap-1">
      <button
        type="button"
        onClick={() => onSelect(team)}
        aria-current={selected ? 'true' : undefined}
        className={`flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
          selected ? 'bg-primary/10' : 'hover:bg-muted/50'
        }`}
      >
        <StatusDot phase={team.phase} />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-medium">{team.name}</span>
            <PhaseBadge kind="team" phase={team.phase} className="shrink-0" />
          </span>
          <span className="truncate text-xs text-muted-foreground">
            成员 {team.workerNames?.length || team.totalWorkers} · 就绪 {team.readyWorkers}/{team.totalWorkers}
            {team.leaderName ? ` · Leader ${team.leaderName}` : ''}
          </span>
          {matchedMembers.length > 0 && (
            <span className="truncate text-xs text-primary">
              匹配成员：{matchedMembers.join('、')}
            </span>
          )}
        </span>
      </button>
      <Button
        variant="ghost"
        size="icon"
        className="min-h-11 min-w-11 shrink-0"
        aria-label={`打开 ${team.name} 团队设置`}
        title="团队设置"
        onClick={() => onOpenSettings(team)}
      >
        <Settings className="size-4" aria-hidden="true" />
      </Button>
    </li>
  );
}

function AgentListRow({
  worker,
  role,
  onOpen,
}: {
  worker: WorkerResponse;
  role: TeamAgentMember['role'];
  onOpen: (_worker: WorkerResponse) => void;
}) {
  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={() => onOpen(worker)}
        className="flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Avatar className="size-7 shrink-0">
          <AvatarFallback className="text-xs">{worker.name.slice(0, 1).toUpperCase()}</AvatarFallback>
        </Avatar>
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-xs font-medium">{worker.name}</span>
            <Badge variant="outline" className="shrink-0 text-xs">
              {ROLE_LABELS[role]}
            </Badge>
            {isAbnormalPhase(worker.phase) && (
              <AlertTriangle className="size-3 shrink-0 text-destructive" aria-label="异常" />
            )}
          </span>
          <span className="truncate text-xs text-muted-foreground">
            {worker.team || '未归属团队'}
            {worker.model ? ` · ${worker.model}` : ''}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
          <StatusDot phase={worker.phase} />
          <PhaseBadge kind="worker" phase={worker.phase} />
        </span>
      </button>
    </li>
  );
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2">
      <span className="w-16 shrink-0 text-xs text-muted-foreground">{label}</span>
      <span className="min-w-0 flex-1 truncate text-xs">{children}</span>
    </div>
  );
}

function TeamAgentsDetail({
  team,
  member,
  onOpenWorker,
  onOpenTeam,
}: {
  team: TeamResponse | null;
  member: TeamAgentMember | null;
  onOpenWorker: (_worker: WorkerResponse) => void;
  onOpenTeam: (_team: TeamResponse) => void;
}) {
  if (member) {
    const { worker, role } = member;
    const sessions = memberSessionCount(worker);
    return (
      <div className="space-y-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Avatar className="size-9 shrink-0">
            <AvatarFallback className="text-sm">{worker.name.slice(0, 1).toUpperCase()}</AvatarFallback>
          </Avatar>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{worker.name}</p>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <StatusDot phase={worker.phase} />
              <PhaseBadge kind="worker" phase={worker.phase} />
              <span>{ROLE_LABELS[role]}</span>
            </p>
          </div>
        </div>
        <div className="space-y-1 rounded-md bg-muted/20 p-2">
          <DetailRow label="团队">{worker.team || '-'}</DetailRow>
          <DetailRow label="模型">{worker.model || '未设置'}</DetailRow>
          <DetailRow label="运行态">{worker.agentStatus || '未上报'}</DetailRow>
          <DetailRow label="在跑任务">
            {worker.runningTaskCount != null ? `${worker.runningTaskCount} 个` : '-'}
          </DetailRow>
          <DetailRow label="会话数">{sessions !== undefined ? `${sessions} 个` : '未上报'}</DetailRow>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 w-full text-xs sm:min-h-9"
          onClick={() => onOpenWorker(worker)}
        >
          打开完整详情
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  if (team) {
    return (
      <div className="space-y-2.5">
        <div className="flex min-w-0 items-center gap-2">
          <Users className="size-4 shrink-0 text-status-done" aria-hidden="true" />
          <p className="min-w-0 flex-1 truncate text-sm font-semibold">{team.name}</p>
          <PhaseBadge kind="team" phase={team.phase} />
        </div>
        <div className="space-y-1 rounded-md bg-muted/20 p-2">
          <DetailRow label="Leader">{team.leaderName || '-'}</DetailRow>
          <DetailRow label="Manager">{team.admin?.name || '-'}</DetailRow>
          <DetailRow label="成员">
            {team.readyWorkers}/{team.totalWorkers} 就绪
          </DetailRow>
          <DetailRow label="团队房间">{team.teamRoomID || '-'}</DetailRow>
          <DetailRow label="描述">{team.description || '-'}</DetailRow>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="min-h-11 w-full text-xs sm:min-h-9"
          onClick={() => onOpenTeam(team)}
        >
          打开团队设置
          <ChevronRight className="size-3.5" aria-hidden="true" />
        </Button>
      </div>
    );
  }

  return (
    <p className="px-1 py-6 text-center text-xs text-muted-foreground">
      选择团队或 Agent 查看详情
    </p>
  );
}

/**
 * 「团队与Agent」合并页（第一实现单）。
 *
 * 四栏壳（含全局侧栏时共四栏）：
 * - xwide ≥1440：团队/Agent 列表 + 交互拓扑 + 右侧详情（3 个内容栏）；
 * - wide 1280–1439：列表 + 拓扑（详情以紧凑卡贴在拓扑下方）；
 * - medium 1024–1279：列表 + 拓扑，详情走既有 WorkerDrawer / TeamDrawer；
 * - narrow <1024：单栏（团队列表 ↔ 拓扑用面包屑返回），详情为全屏侧栏。
 *
 * 页面级「团队 / Agent」页签只用于承接旧路由的 tab 语义
 *（#console/resources/workers → Agent，#console/resources/teams → 团队）；
 * 左侧全局导航本身已经只有一个「团队与Agent」入口。
 */
export function TeamAgentsSection() {
  const { data: teams, isLoading, isError, refetch, isRefetching } = useTeams();
  const { data: workers } = useWorkers();
  const { searchQuery } = useSearch();
  const { isConnected, userLevel } = useAgentTeamsStore();
  const { options: modelOptions, sessionIssue } = useModelSelection();
  const queryClient = useQueryClient();
  const layout = useTeamAgentsLayout();

  const createTeam = useCreateTeam();
  const createWorker = useCreateWorker();

  const [tab, setTab] = useState<TeamAgentsTab>(() =>
    typeof window === 'undefined' ? 'teams' : teamAgentsTabFromHash(window.location.hash),
  );
  const [selectedTeamName, setSelectedTeamName] = useState<string | null>(null);
  const [selectedWorkerName, setSelectedWorkerName] = useState<string | null>(null);
  const [narrowView, setNarrowView] = useState<'list' | 'detail'>('list');

  const [drawerWorker, setDrawerWorker] = useState<WorkerResponse | null>(null);
  const [teamDrawerName, setTeamDrawerName] = useState<string | null>(null);

  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [newTeam, setNewTeam] = useState<CreateTeamRequest>(EMPTY_TEAM);
  const [createWorkerOpen, setCreateWorkerOpen] = useState(false);
  const [newWorker, setNewWorker] = useState<CreateWorkerRequest>(EMPTY_WORKER);

  useEffect(() => {
    const syncTab = () => setTab(teamAgentsTabFromHash(window.location.hash));
    window.addEventListener('hashchange', syncTab);
    return () => window.removeEventListener('hashchange', syncTab);
  }, []);

  // 默认选中第一个团队，让 xwide/wide/medium 的拓扑栏首屏就有内容；
  // 选中项被删除（或改名）时回落到第一个。
  useEffect(() => {
    if (!teams) return;
    if (selectedTeamName && teams.some((team) => team.name === selectedTeamName)) return;
    setSelectedTeamName(teams[0]?.name ?? null);
  }, [teams, selectedTeamName]);

  const refresh = useCallback(() => {
    void refetch();
    void queryClient.invalidateQueries({ queryKey: ['agentteams-workers'] });
  }, [queryClient, refetch]);

  const teamRows = useMemo(() => {
    const rows = filterTeamRows(teams, workers, searchQuery);
    return [...rows].sort((a, b) => (a.team.name || '').localeCompare(b.team.name || ''));
  }, [teams, workers, searchQuery]);

  const workerRows = useMemo(() => filterWorkerRows(workers, searchQuery), [workers, searchQuery]);

  const selectedTeam = useMemo(
    () => (teams ?? []).find((team) => team.name === selectedTeamName) ?? null,
    [teams, selectedTeamName],
  );

  const selectedMember = useMemo(() => {
    if (!selectedWorkerName) return null;
    const worker = (workers ?? []).find((item) => item.name === selectedWorkerName);
    if (!worker) return null;
    const homeTeam = (teams ?? []).find(
      (team) => team.name === worker.team || team.teamName === worker.team,
    );
    return { worker, role: memberRole(worker, homeTeam?.leaderName) } satisfies TeamAgentMember;
  }, [workers, selectedWorkerName, teams]);

  // Agent 页签的拓扑跟随选中 Agent 所属团队（未归属则回落到当前团队）。
  const agentTopologyTeam = useMemo(() => {
    if (!selectedMember?.worker.team) return selectedTeam;
    return (
      (teams ?? []).find(
        (team) => team.name === selectedMember.worker.team || team.teamName === selectedMember.worker.team,
      ) ?? selectedTeam
    );
  }, [selectedMember, selectedTeam, teams]);

  const topologyTeam = tab === 'agents' ? agentTopologyTeam : selectedTeam;

  const handleTabChange = useCallback((next: string) => {
    const value: TeamAgentsTab = next === 'agents' ? 'agents' : 'teams';
    setTab(value);
    const target = `#${TEAM_AGENTS_HASH}?tab=${value}`;
    if (window.location.hash !== target) {
      window.location.hash = target;
    }
  }, []);

  const handleSelectTeam = useCallback(
    (team: TeamResponse) => {
      setSelectedTeamName(team.name);
      setNarrowView('detail');
    },
    [],
  );

  const handleOpenTeamSettings = useCallback((team: TeamResponse) => {
    setTeamDrawerName(team.name);
  }, []);

  const handleOpenWorker = useCallback((worker: WorkerResponse) => {
    setSelectedWorkerName(worker.name);
    if (worker.team) {
      setSelectedTeamName((current) => current ?? worker.team);
    }
    setDrawerWorker(worker);
  }, []);

  const handleCreateTeam = useCallback(() => {
    createTeam.mutate(newTeam, {
      onSuccess: (created) => {
        setCreateTeamOpen(false);
        setNewTeam(EMPTY_TEAM);
        if (created?.name) {
          setSelectedTeamName(created.name);
          setTab('teams');
        }
      },
    });
  }, [createTeam, newTeam]);

  const handleCreateWorker = useCallback(() => {
    createWorker.mutate(newWorker, {
      onSuccess: () => {
        setCreateWorkerOpen(false);
        setNewWorker(EMPTY_WORKER);
      },
    });
  }, [createWorker, newWorker]);

  if (isError && !isConnected) {
    return <ApiErrorState />;
  }

  const narrow = layout === 'narrow';
  const narrowDetail = narrow && tab === 'teams' && narrowView === 'detail';
  const showList = !narrowDetail;
  const showMain = !narrow || narrowDetail;
  const liveTeamDrawer = (teams ?? []).find((team) => team.name === teamDrawerName) ?? null;

  const listPane = (
    <Pane label={tab === 'teams' ? '团队列表' : 'Agent 列表'}>
      <PaneHeader
        title={tab === 'teams' ? '团队' : 'Agent'}
        meta={
          searchQuery.trim()
            ? `${(tab === 'teams' ? teamRows.length : workerRows.length)} / ${(tab === 'teams' ? teams?.length : workers?.length) ?? 0}`
            : `${(tab === 'teams' ? teams?.length : workers?.length) ?? 0}`
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-1.5 custom-scrollbar">
        {isLoading ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">加载中…</p>
        ) : tab === 'teams' ? (
          teamRows.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              {searchQuery.trim() ? '没有匹配的团队 / 成员' : '暂无团队'}
            </p>
          ) : (
            <ul className="space-y-0.5">
              {teamRows.map((row) => (
                <TeamListRow
                  key={row.team.name}
                  row={row}
                  selected={!narrowDetail && row.team.name === selectedTeamName}
                  onSelect={handleSelectTeam}
                  onOpenSettings={handleOpenTeamSettings}
                />
              ))}
            </ul>
          )
        ) : workerRows.length === 0 ? (
          <p className="px-2 py-8 text-center text-xs text-muted-foreground">
            {searchQuery.trim() ? '没有匹配的 Agent' : '暂无 Agent'}
          </p>
        ) : (
          <ul className="space-y-0.5">
            {workerRows.map((worker) => {
              const team = (teams ?? []).find((item) => item.name === worker.team);
              return (
                <AgentListRow
                  key={worker.name}
                  worker={worker}
                  role={memberRole(worker, team?.leaderName)}
                  onOpen={handleOpenWorker}
                />
              );
            })}
          </ul>
        )}
      </div>
    </Pane>
  );

  const topology = topologyTeam ? (
    <InteractiveTeamTopology
      team={topologyTeam}
      workers={workers}
      searchQuery={searchQuery}
      highlightWorkerName={tab === 'agents' ? selectedWorkerName : null}
      onOpenWorker={handleOpenWorker}
      onOpenTeamSettings={handleOpenTeamSettings}
      onBack={narrowDetail ? () => setNarrowView('list') : undefined}
    />
  ) : (
    <Pane label="团队拓扑">
      <p className="px-3 py-10 text-center text-xs text-muted-foreground">
        {tab === 'teams' ? '选择团队查看拓扑' : '选择 Agent 查看所属团队拓扑'}
      </p>
    </Pane>
  );

  const mainPane = (
    <div className="flex min-h-0 min-w-0 flex-col gap-2">
      <div className="min-h-0 flex-1">{topology}</div>
      {layout === 'wide' && (
        <Pane label="详情" className="max-h-[38%] shrink-0">
          <PaneHeader title="详情" />
          <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
            <TeamAgentsDetail
              team={selectedTeam}
              member={selectedMember}
              onOpenWorker={handleOpenWorker}
              onOpenTeam={handleOpenTeamSettings}
            />
          </div>
        </Pane>
      )}
    </div>
  );

  const detailPane = (
    <Pane label="详情">
      <PaneHeader title="详情" />
      <div className="min-h-0 flex-1 overflow-y-auto p-3 custom-scrollbar">
        <TeamAgentsDetail
          team={selectedTeam}
          member={selectedMember}
          onOpenWorker={handleOpenWorker}
          onOpenTeam={handleOpenTeamSettings}
        />
      </div>
    </Pane>
  );

  return (
    <div className="space-y-3" data-testid="team-agents-section" data-layout={layout}>
      <SectionHeader
        title="团队与Agent"
        description="团队拓扑、成员状态与 Agent 详情"
        isLive={isConnected}
        onRefresh={() => refetch()}
        isRefreshing={isRefetching}
        actions={
          <div className="flex gap-2">
            <Button
              size="sm"
              variant="outline"
              className="min-h-11 text-xs sm:min-h-9"
              onClick={() => setCreateWorkerOpen(true)}
            >
              <Bot className="size-3.5" aria-hidden="true" />
              创建 Agent
            </Button>
            <Button
              size="sm"
              className="min-h-11 text-xs sm:min-h-9"
              onClick={() => setCreateTeamOpen(true)}
            >
              <Plus className="size-3.5" aria-hidden="true" />
              创建团队
            </Button>
          </div>
        }
      />

      {/* 页签只为承接旧 workers/teams 深链的 tab；全局导航只有一个入口。 */}
      <Tabs value={tab} onValueChange={handleTabChange}>
        <TabsList className="h-9">
          <TabsTrigger value="teams" className="gap-1 text-xs">
            团队
            <span className="tabular-nums text-muted-foreground">{teams?.length ?? 0}</span>
          </TabsTrigger>
          <TabsTrigger value="agents" className="gap-1 text-xs">
            Agent
            <span className="tabular-nums text-muted-foreground">{workers?.length ?? 0}</span>
          </TabsTrigger>
        </TabsList>
      </Tabs>

      <div
        data-testid="team-agents-shell"
        className={`grid h-[calc(100dvh-17rem)] max-h-[1200px] min-h-[420px] w-full min-w-0 gap-3 overflow-x-hidden overflow-y-hidden ${shellGridClass(layout)}`}
      >
        {showList && listPane}
        {showMain && mainPane}
        {layout === 'xwide' && detailPane}
      </div>

      <WorkerDrawer
        worker={drawerWorker}
        onOpenChange={(open) => !open && setDrawerWorker(null)}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        userLevel={userLevel}
        onChanged={refresh}
        onDeleted={() => {
          setDrawerWorker(null);
          refresh();
        }}
      />

      <TeamDrawer
        team={liveTeamDrawer}
        allTeams={teams ?? []}
        workers={workers ?? []}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        userLevel={userLevel}
        onOpenChange={(open) => !open && setTeamDrawerName(null)}
        onChanged={refresh}
        onDeleted={() => {
          setTeamDrawerName(null);
          refresh();
        }}
      />

      <TeamCreateDialog
        open={createTeamOpen}
        onOpenChange={setCreateTeamOpen}
        value={newTeam}
        onChange={setNewTeam}
        isPending={createTeam.isPending}
        onSubmit={handleCreateTeam}
        workers={workers ?? []}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        onWorkerCreated={refresh}
      />

      <WorkerCreateDialog
        open={createWorkerOpen}
        onOpenChange={setCreateWorkerOpen}
        value={newWorker}
        onChange={setNewWorker}
        isPending={createWorker.isPending}
        onSubmit={handleCreateWorker}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
      />
    </div>
  );
}
