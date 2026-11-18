'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SectionHeader } from '@/components/dashboard/section-header';
import { OverflowText } from '@/components/dashboard/overflow-text';
import { ListPagination, useListPagination } from '@/components/dashboard/list-pagination';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { useCreateTeam, useCreateWorker } from '@/hooks/use-agentteams-mutations';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { useModelSelection } from '@/hooks/use-model-selection';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useSearch } from '@/lib/search-context';
import { currentHashParams, hashForSection, type TeamAgentsTab } from '@/lib/nav-hash';
import type { CreateTeamRequest, CreateWorkerRequest, TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import { teamHumanMembers } from '@/lib/agentteams-api';
import { TeamCreateDialog } from '../teams/team-create-dialog';
import { TeamSettingsPanel } from '../teams/team-settings-panel';
import { MillforgeDialog } from '../teams/millforge/millforge-dialog';
import { WorkerCreateDialog } from '../workers/worker-create-dialog';
import { WorkerDetailDialog } from '../workers/worker-detail-dialog';
import { WorkerDetailPanel } from '../workers/worker-detail-panel';
import { WorkerDrawer } from '../workers/worker-drawer';
import {
  agentSortKeys,
  fallbackAgentSort,
  filterTeamRows,
  formatAgentSortPreference,
  paginateAgentCards,
  parseAgentSortPreference,
  teamMemberWorkers,
  teamAgentsInitialIntentFromHash,
  type AgentSortKey,
  type AgentSortState,
} from './team-agents-logic';
import { MemberPreview } from './member-preview';
import { AgentSummaryCard, HumanSummaryCard, ResourceIdentity } from './resource-summary-card';
import { TeamAgentsWorkbench } from './team-agents-workbench';
import { TeamDetailDialog } from './team-detail-dialog';

const RESOURCE_CARD_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] items-start gap-5';

const EMPTY_TEAM: CreateTeamRequest = { name: '', leader: { name: '' }, workerNames: [] };
const EMPTY_WORKER: CreateWorkerRequest = { name: '', runtime: 'openclaw' };

/** 团队页视图：卡片（默认）/ 拓扑（整页渲染工作台）。 */
type TeamPageView = 'cards' | 'topology';
const VIEW_STORAGE_KEY = 'teamAgents.view';

function openResource(hash: string) {
  window.location.hash = hash;
}

/** localStorage 里的视图偏好；非法值忽略。 */
function readStoredView(): TeamPageView | null {
  if (typeof window === 'undefined') return null;
  try {
    const stored = window.localStorage.getItem(VIEW_STORAGE_KEY);
    return stored === 'cards' || stored === 'topology' ? stored : null;
  } catch {
    return null;
  }
}

/** URL ?view= 合法值优先，其次 localStorage，默认卡片。 */
function resolvePageView(urlView: string | null): TeamPageView {
  if (urlView === 'cards' || urlView === 'topology') return urlView;
  return readStoredView() ?? 'cards';
}

// 智能体卡片：分组开关 / 排序 / 组折叠的持久化（④；键形 team:asc / admin:desc / name:asc）。
const GROUPED_STORAGE_KEY = 'teamAgents.grouped';
const SORT_STORAGE_KEY = 'teamAgents.sort';
const COLLAPSED_STORAGE_KEY = 'teamAgents.groupCollapsed';

/** 「无团队」组的折叠键（团队名不存在，用固定哨兵）。 */
export const NO_TEAM_GROUP_KEY = '__none__';

/** 排序键显示名：分组开 = 团队名称 / Human 名称；分组关 = 智能体名称。 */
const AGENT_SORT_KEY_LABELS: Record<AgentSortKey, string> = {
  team: '团队名称',
  admin: 'Human 名称',
  name: '智能体名称',
};

/** localStorage `teamAgents.grouped`（'1'/'0'），默认开；非法值忽略。 */
function readStoredGrouped(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return window.localStorage.getItem(GROUPED_STORAGE_KEY) !== '0';
  } catch {
    return true;
  }
}

/** localStorage `teamAgents.sort`；非法值或当前分组模式下不适用 → 该模式默认键（asc）。 */
function readStoredAgentSort(grouped: boolean): AgentSortState {
  if (typeof window === 'undefined') return { key: grouped ? 'team' : 'name', dir: 'asc' };
  try {
    const parsed = parseAgentSortPreference(window.localStorage.getItem(SORT_STORAGE_KEY));
    return parsed ? fallbackAgentSort(parsed, grouped) : { key: grouped ? 'team' : 'name', dir: 'asc' };
  } catch {
    return { key: grouped ? 'team' : 'name', dir: 'asc' };
  }
}

/** localStorage `teamAgents.groupCollapsed`（JSON string[]，含「无团队」哨兵键）；非法值忽略。 */
function readStoredCollapsedGroups(): string[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(COLLAPSED_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : [];
  } catch {
    return [];
  }
}

function writeStoredGrouped(grouped: boolean) {
  try {
    window.localStorage.setItem(GROUPED_STORAGE_KEY, grouped ? '1' : '0');
  } catch {
    // 隐私模式等写入失败：偏好丢失可接受。
  }
}

function writeStoredAgentSort(sort: AgentSortState) {
  try {
    window.localStorage.setItem(SORT_STORAGE_KEY, formatAgentSortPreference(sort));
  } catch {
    // 同上。
  }
}

function writeStoredCollapsedGroups(groups: string[]) {
  try {
    window.localStorage.setItem(COLLAPSED_STORAGE_KEY, JSON.stringify(groups));
  } catch {
    // 同上。
  }
}

function readLocation() {
  const params = currentHashParams();
  return {
    tab: (typeof window === 'undefined' ? 'teams' : teamAgentsInitialIntentFromHash(window.location.hash)) as TeamAgentsTab,
    team: params?.get('team') ?? null, agent: params?.get('agent') ?? null,
    edit: params?.get('edit') === 'true',
    view: params?.get('view') ?? null,
  };
}

export function AgentsSection() { return <TeamAgentsSection view="agents" />; }
export function TeamsSection() { return <TeamAgentsSection view="teams" />; }

export function TeamAgentsSection({ view }: { view?: TeamAgentsTab } = {}) {
  const teamsQuery = useTeams();
  const workersQuery = useWorkers();
  const { data: humans } = useHumans();
  const { searchQuery } = useSearch();
  const { isConnected, userLevel } = useAgentTeamsStore();
  const { options: modelOptions, sessionIssue } = useModelSelection();
  const queryClient = useQueryClient();
  const createTeam = useCreateTeam();
  const createWorker = useCreateWorker();
  const [location, setLocation] = useState<ReturnType<typeof readLocation>>(() => ({ ...readLocation(), ...(view ? { tab: view } : {}) }));
  // 视图偏好只作用于团队页：智能体页/其它 tab 恒为卡片视图，
  // 避免 localStorage 里残留的 topology 把智能体页渲染成团队拓扑。
  const pageView: TeamPageView = location.tab === 'teams' ? resolvePageView(location.view) : 'cards';
  const [search, setSearch] = useState('');
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [createWorkerOpen, setCreateWorkerOpen] = useState(false);
  const [newTeam, setNewTeam] = useState<CreateTeamRequest>(EMPTY_TEAM);
  const [newWorker, setNewWorker] = useState<CreateWorkerRequest>(EMPTY_WORKER);
  const [millforgeTeam, setMillforgeTeam] = useState<string | null>(null);
  // 卡片「详情/编辑」入口（整改①）：详情 = 只读弹窗；编辑 = 可编辑面。
  const [detailWorker, setDetailWorker] = useState<WorkerResponse | null>(null);
  const [editWorker, setEditWorker] = useState<WorkerResponse | null>(null);
  const [editTeam, setEditTeam] = useState<TeamResponse | null>(null);
  // ④ 智能体卡片分组 / 排序 / 组折叠：localStorage 持久化（分组默认开）。
  const [agentGrouped, setAgentGrouped] = useState(() => readStoredGrouped());
  const [agentSort, setAgentSort] = useState<AgentSortState>(() => readStoredAgentSort(readStoredGrouped()));
  const [collapsedGroups, setCollapsedGroups] = useState<string[]>(() => readStoredCollapsedGroups());

  useEffect(() => {
    const sync = () => setLocation({ ...readLocation(), ...(view ? { tab: view } : {}) });
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, [view]);

  function navigate(tab: TeamAgentsTab, kind?: 'team' | 'agent', name?: string, edit = false) {
    const params = new URLSearchParams();
    if (kind && name) params.set(kind, name);
    if (edit) params.set('edit', 'true');
    openResource(`${hashForSection(tab === 'agents' ? 'workers' : 'teams')}${params.size ? `?${params}` : ''}`);
    setLocation(readLocation());
  }

  /** 视图切换：写 localStorage 偏好 + URL ?view=topology（拓扑）；卡片为默认值，URL 不留痕。 */
  function switchView(next: TeamPageView) {
    try {
      window.localStorage.setItem(VIEW_STORAGE_KEY, next);
    } catch {
      // 隐私模式等写入失败：URL 优先，偏好丢失可接受。
    }
    const params = new URLSearchParams(currentHashParams()?.toString() ?? '');
    if (next === 'topology') {
      params.set('view', 'topology');
    } else {
      // 回到卡片列表：收起拓扑视图的选中状态（工作台会把选中写回 URL），列表页不留选中。
      params.delete('view');
      for (const key of ['team', 'agent', 'manager', 'human', 'edit', 'panel']) params.delete(key);
    }
    openResource(`${hashForSection('teams')}${params.size ? `?${params}` : ''}`);
    setLocation({ ...readLocation(), ...(view ? { tab: view } : {}) });
  }

  function refresh() {
    void teamsQuery.refetch();
    for (const key of ['agentteams-workers', 'agentteams-humans']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  // ④ 分组开关：当前排序键在新模式下不适用 → 回落到该模式默认键（dir 保留）；
  // resetKey 变化 → 回第 1 页。
  function handleGroupedChange(next: boolean) {
    const sort = fallbackAgentSort(agentSort, next);
    setAgentGrouped(next);
    setAgentSort(sort);
    writeStoredGrouped(next);
    writeStoredAgentSort(sort);
  }
  function handleSortKeyChange(next: AgentSortKey) {
    const sort = { ...agentSort, key: next };
    setAgentSort(sort);
    writeStoredAgentSort(sort);
  }
  function handleSortDirToggle() {
    const sort: AgentSortState = { ...agentSort, dir: agentSort.dir === 'asc' ? 'desc' : 'asc' };
    setAgentSort(sort);
    writeStoredAgentSort(sort);
  }
  // ④ 组折叠（仅分组开生效；「无团队」组键 = NO_TEAM_GROUP_KEY）。
  function toggleGroupCollapsed(key: string) {
    const next = collapsedGroups.includes(key)
      ? collapsedGroups.filter((item) => item !== key)
      : [...collapsedGroups, key];
    setCollapsedGroups(next);
    writeStoredCollapsedGroups(next);
  }

  const teams = teamsQuery.data ?? [];
  const workers = workersQuery.data ?? [];
  const query = `${searchQuery} ${search}`.trim().toLowerCase();
  const teamRows = filterTeamRows(teams, workers, query);
  const allAgents = [
    ...workers.map((worker) => ({ ...worker, kind: 'agent' as const, label: teams.some((team) => team.leaderName === worker.name) ? '团队负责人 · Leader' : '执行成员 · Worker' })),
  ].sort((a, b) => a.name.localeCompare(b.name));
  const agents = allAgents.filter((agent) => [agent.name, agent.model, agent.runtime, agent.team].some((value) => value?.toLowerCase().includes(query)));
  const teamPage = useListPagination(teamRows, 12, `${location.tab}:${query}`);
  // ① 智能体卡片分页：分组开 = 按整组切页（组不跨页）；分组关 = 平铺每 12 条。
  // 页码为 useListPagination 之外的最小 state，沿用同一同步模式：
  // resetKey（tab + 搜索 + 分组 + 排序键 + 方向）变化 → 回第 1 页；超总页数 → 收拢。
  const agentPaging = paginateAgentCards(agents, teams, { grouped: agentGrouped, sort: agentSort }, 12);
  const agentPageResetKey = `${location.tab}:${query}:${agentGrouped ? 'g' : 'f'}:${agentSort.key}:${agentSort.dir}`;
  const [agentPageState, setAgentPageState] = useState({ key: agentPageResetKey, page: 1 });
  const agentPageTotal = Math.max(1, agentPaging.totalPages);
  const agentPage = agentPageState.key === agentPageResetKey ? Math.min(agentPageState.page, agentPageTotal) : 1;
  if (agentPageState.key !== agentPageResetKey || agentPageState.page !== agentPage) {
    setAgentPageState({ key: agentPageResetKey, page: agentPage });
  }
  const agentPageGroups = agentPaging.pages[agentPage - 1] ?? [];
  const selectedTeam = teams.find((team) => team.name === location.team);
  const selectedWorker = workers.find((worker) => worker.name === location.agent);
  const isDetail = Boolean(location.team || location.agent);
  const forgingTeam = teams.find((team) => team.name === millforgeTeam);

  function humanChip(name: string) {
    const human = humans?.find((item) => item.name === name);
    const onView = () => openResource(`${hashForSection('humans')}?human=${encodeURIComponent(name)}`);
    return <MemberPreview key={name} name={name} label={human?.displayName} onOpen={onView}>
      <HumanSummaryCard name={name} human={human} onView={onView} />
    </MemberPreview>;
  }
  function agentChip(name: string) {
    const worker = workers.find((item) => item.name === name);
    const agent = allAgents.find((item) => item.kind === 'agent' && item.name === name)
      ?? { name, model: '', runtime: '', phase: '', team: '', kind: 'agent' as const, label: 'Worker' };
    const onOpen = () => navigate('agents', 'agent', name);
    return <MemberPreview key={name} name={name} onOpen={onOpen}>
      <AgentSummaryCard
        agent={agent}
        onOpen={onOpen}
        onView={() => { if (worker) setDetailWorker(worker); }}
        onEdit={() => { if (worker) setEditWorker(worker); }}
      />
    </MemberPreview>;
  }
  function memberList(names: string[], renderMember: (_name: string) => ReactNode, label: string, title: string) {
    return <div className={`grid min-w-0 items-center gap-1.5 ${names.length > 2 ? 'grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto]' : 'grid-cols-2'}`}>
      {names.slice(0, 2).map(renderMember)}
      {names.length > 2 && <MemberPreview name={label} label={`… +${names.length - 2}`} ariaLabel={`展开${label}`}>
        <div className="p-4"><h3 className="mb-3 truncate text-sm font-medium">{title} · {names.length}</h3><div className="grid max-h-64 gap-2 overflow-y-auto">{names.map(renderMember)}</div></div>
      </MemberPreview>}
    </div>;
  }

  if ((teamsQuery.isError || workersQuery.isError) && !isConnected) return <ApiErrorState />;

  // 视图切换（仅团队页）：卡片（默认）/ 拓扑（整页渲染工作台）。每项 ≥44px。
  const viewToggle = view === 'teams' ? (
    <div role="group" aria-label="视图切换" className="flex h-11 items-stretch rounded-lg border bg-muted/30">
      <button type="button" aria-pressed={pageView === 'cards'} aria-label="卡片视图" onClick={() => switchView('cards')}
        className={`min-w-11 rounded-l-lg px-3 text-sm transition-colors ${pageView === 'cards' ? 'bg-background font-medium' : 'text-muted-foreground hover:text-foreground'}`}>卡片</button>
      <button type="button" aria-pressed={pageView === 'topology'} aria-label="拓扑视图" onClick={() => switchView('topology')}
        className={`min-w-11 rounded-r-lg border-l px-3 text-sm transition-colors ${pageView === 'topology' ? 'bg-background font-medium' : 'text-muted-foreground hover:text-foreground'}`}>拓扑</button>
    </div>
  ) : null;

  return <div className="space-y-4" data-testid="team-agents-section">
    <SectionHeader title={view === 'agents' ? '智能体' : view === 'teams' ? '团队' : '团队与智能体'} onRefresh={refresh} isRefreshing={teamsQuery.isRefetching}
      meta={pageView === 'topology' && viewToggle ? viewToggle
        : !isDetail && <div className="flex min-w-0 flex-wrap items-center gap-3">{!view && <Tabs value={location.tab} onValueChange={(value) => navigate(value as TeamAgentsTab)}><TabsList aria-label="资源分类">
        <TabsTrigger value="teams">团队 <span className="text-muted-foreground tabular-nums">{teams.length}</span></TabsTrigger>
        <TabsTrigger value="agents">智能体 <span className="text-muted-foreground tabular-nums">{workers.length}</span></TabsTrigger>
      </TabsList></Tabs>}
        <Input className="h-9 w-72 max-w-full" aria-label="搜索团队或智能体" placeholder={location.tab === 'teams' ? '搜索团队或成员…' : '搜索名称、模型或运行时…'} value={search} onChange={(event) => setSearch(event.target.value)} />
        {location.tab === 'agents' && (
          // ④ 智能体分组 / 排序控件（仅智能体 tab）：分组开关 + 排序键 + 升降序。
          <div role="group" aria-label="分组与排序" className="flex flex-wrap items-center gap-2">
            <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm">
              <Switch checked={agentGrouped} onCheckedChange={handleGroupedChange} aria-label="按团队分类" />
              按团队分类
            </label>
            <Select value={agentSort.key} onValueChange={(value) => handleSortKeyChange(value as AgentSortKey)}>
              <SelectTrigger aria-label="排序键" className="w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {agentSortKeys(agentGrouped).map((key) => (
                  <SelectItem key={key} value={key}>{AGENT_SORT_KEY_LABELS[key]}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              variant="outline"
              size="icon"
              aria-label={agentSort.dir === 'asc' ? '升序' : '降序'}
              aria-pressed={agentSort.dir === 'asc'}
              title={agentSort.dir === 'asc' ? '升序' : '降序'}
              onClick={handleSortDirToggle}
            >
              {agentSort.dir === 'asc' ? <ArrowUp aria-hidden="true" /> : <ArrowDown aria-hidden="true" />}
            </Button>
          </div>
        )}
        {viewToggle}
      </div>}
      actions={pageView === 'topology' ? undefined : isDetail ? <Button size="sm" variant="outline" onClick={() => navigate(location.tab)}>返回列表</Button> :
        <Button size="sm" onClick={() => location.tab === 'teams' ? setCreateTeamOpen(true) : setCreateWorkerOpen(true)}>{location.tab === 'teams' ? '创建团队' : '创建智能体'}</Button>} />

    {pageView === 'topology' ? <TeamAgentsWorkbench />
      : isDetail ? <div className="flex h-[calc(100dvh-15rem)] min-h-[420px] flex-col rounded-xl border bg-card">
      {!selectedWorker && <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <h2 className="min-w-0 font-medium"><OverflowText text={`${location.edit ? '编辑' : '详情'} · ${selectedTeam?.teamName || location.team || location.agent}`} /></h2>
        {selectedTeam && <Button size="sm" variant="outline" onClick={() => setMillforgeTeam(selectedTeam.name)}>千锻 · 团队配置</Button>}
      </div>}
      {selectedTeam ? <TeamSettingsPanel key={selectedTeam.name} team={selectedTeam} allTeams={teams} workers={workers} modelOptions={modelOptions} sessionIssue={sessionIssue} userLevel={userLevel} onChanged={refresh} onDeleted={() => navigate('teams')} /> :
        selectedWorker ? <WorkerDetailPanel key={selectedWorker.name} worker={selectedWorker} modelOptions={modelOptions} sessionIssue={sessionIssue} userLevel={userLevel} className="min-h-0 flex-1" onChanged={refresh} onDeleted={() => navigate('agents')} /> :
            <p className="p-6 text-sm text-muted-foreground">{teamsQuery.isLoading || workersQuery.isLoading ? '正在加载…' : '未找到该资源，请返回列表刷新。'}</p>}
    </div> : <>
      {teamsQuery.isLoading || workersQuery.isLoading ? <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((item) => <div key={item} className="h-56 rounded-xl border bg-muted/30 animate-pulse" />)}</div> :
        location.tab === 'teams' ? <div className={RESOURCE_CARD_GRID} aria-label="团队卡片">
          {teamPage.items.map(({ team }) => {
            const members = [...new Set([...teamHumanMembers(team).map((member) => member.name), ...(humans ?? []).filter((human) => human.accessibleTeams?.includes(team.name)).map((human) => human.name)])].filter((name) => name !== team.admin?.name).sort((a, b) => a.localeCompare(b));
            const teamWorkers = teamMemberWorkers(team, workers).filter((worker) => worker.name !== team.leaderName);
            return <Card key={team.name} className="min-w-0 w-full max-w-[360px] gap-0 overflow-hidden rounded-2xl border-border/80 py-0 shadow-sm transition-shadow hover:shadow-md"><CardContent className="space-y-4 p-5">
              <ResourceIdentity name={team.teamName || team.name} role={`团队 · ${members.length + (team.admin?.name ? 1 : 0)} 人 · ${teamWorkers.length + (team.leaderName ? 1 : 0)} 智能体`} kind="team" phase={team.phase} onView={() => navigate('teams', 'team', team.name)} />
              <OverflowText text={team.description || ''} multiline className="h-10 text-xs leading-5 text-muted-foreground" />
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 text-sm">
                <dt className="pt-1 text-muted-foreground">Team Admin</dt><dd className="h-7 min-w-0">{team.admin?.name ? humanChip(team.admin.name) : '未设置'}</dd>
                <dt className="pt-1 text-muted-foreground">普通成员 · {members.length}</dt><dd className="h-7 min-w-0">{members.length ? memberList(members, humanChip, `${team.teamName || team.name}的普通成员`, '普通成员') : <span className="text-muted-foreground">暂无普通成员</span>}</dd>
                <dt className="pt-1 text-muted-foreground">Leader</dt><dd className="h-7 min-w-0">{team.leaderName ? agentChip(team.leaderName) : '未设置'}</dd>
                <dt className="pt-1 text-muted-foreground">Workers · {teamWorkers.length}</dt><dd className="h-7 min-w-0">{teamWorkers.length ? memberList(teamWorkers.map((worker) => worker.name), agentChip, `${team.teamName || team.name}的 Workers`, 'Workers') : <span className="text-muted-foreground">暂无 Worker</span>}</dd>
              </dl>
            </CardContent><div className="flex shrink-0 items-center justify-end gap-2 border-t border-border/60 px-5 py-3"><Button variant="outline" size="sm" onClick={() => navigate('teams', 'team', team.name)}>详情</Button><Button variant="outline" size="sm" onClick={() => setEditTeam(team)}>编辑</Button></div></Card>;
          })}
          {teamRows.length === 0 && <p className="py-12 text-sm text-muted-foreground">{query ? '没有匹配的团队' : '暂无团队，创建团队开始协作。'}</p>}
        </div> : agents.length === 0 ? <p className="py-12 text-sm text-muted-foreground">{query ? '没有匹配的智能体' : '暂无智能体'}</p> : (
          // 分组 / 平铺 + 分页（①④）：
          // 分组开 = 按整组切页（组不跨页），组头 = 团队名（可点，跳团队详情）
          // + 成员数 + 折叠 chevron；「无团队」组恒最后；组内恒按名称升序。
          // 分组关 = 无组头平铺网格，按智能体名升/降序每 12 条切页。
          agentGrouped ? (
            <div className="space-y-6" aria-label="智能体卡片">
              {agentPageGroups.map((group) => {
                const groupTeam = group.team ? teams.find((item) => item.name === group.team) : undefined;
                const groupTitle = groupTeam ? groupTeam.teamName || groupTeam.name : '无团队';
                const collapsedKey = group.team === '' ? NO_TEAM_GROUP_KEY : group.team;
                const collapsed = collapsedGroups.includes(collapsedKey);
                return <section key={group.team || 'none'} data-testid="agent-team-group" data-team={group.team} className="min-w-0">
                  <h2 className="mb-3 flex min-h-11 items-center gap-2 text-sm font-medium sm:min-h-0">
                    {groupTeam
                      ? <button type="button" onClick={() => navigate('teams', 'team', groupTeam.name)} className="min-w-0 hover:underline" title={`打开团队详情 ${groupTitle}`}>{groupTitle}</button>
                      : <span className="text-muted-foreground">{groupTitle}</span>}
                    <span className="text-xs font-normal tabular-nums text-muted-foreground">· {group.agents.length} 个智能体</span>
                    <button
                      type="button"
                      aria-expanded={!collapsed}
                      aria-label={collapsed ? `展开分组 ${groupTitle}` : `折叠分组 ${groupTitle}`}
                      title={collapsed ? `展开分组 ${groupTitle}` : `折叠分组 ${groupTitle}`}
                      onClick={() => toggleGroupCollapsed(collapsedKey)}
                      className="ml-auto flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none sm:size-9"
                    >
                      {collapsed ? <ChevronDown className="size-4" aria-hidden="true" /> : <ChevronRight className="size-4" aria-hidden="true" />}
                    </button>
                  </h2>
                  {!collapsed && (
                    <div className={RESOURCE_CARD_GRID}>
                      {group.agents.map((agent) => <AgentSummaryCard key={`${agent.kind}-${agent.name}`} agent={agent}
                        onOpen={() => navigate('agents', agent.kind, agent.name)}
                        onView={() => setDetailWorker(agent)}
                        onEdit={() => setEditWorker(agent)} />)}
                    </div>
                  )}
                </section>;
              })}
            </div>
          ) : (
            <div className={RESOURCE_CARD_GRID} aria-label="智能体卡片">
              {agentPageGroups.flatMap((group) => group.agents).map((agent) => <AgentSummaryCard key={`${agent.kind}-${agent.name}`} agent={agent}
                onOpen={() => navigate('agents', agent.kind, agent.name)}
                onView={() => setDetailWorker(agent)}
                onEdit={() => setEditWorker(agent)} />)}
            </div>
          )
        )}
      {!teamsQuery.isLoading && !workersQuery.isLoading && (location.tab === 'teams'
        ? <ListPagination {...teamPage} label="团队" />
        : <ListPagination page={agentPage} totalPages={agentPageTotal} totalItems={agentPaging.totalItems} label="智能体" onChange={(page) => setAgentPageState({ key: agentPageResetKey, page })} />)}
    </>}

    <TeamCreateDialog open={createTeamOpen} onOpenChange={setCreateTeamOpen} value={newTeam} onChange={setNewTeam} isPending={createTeam.isPending} workers={workers} modelOptions={modelOptions} sessionIssue={sessionIssue} onWorkerCreated={refresh}
      onSubmit={() => createTeam.mutate(newTeam, { onSuccess: (created) => { setCreateTeamOpen(false); setNewTeam(EMPTY_TEAM); if (created?.name) navigate('teams', 'team', created.name); } })} />
    <WorkerCreateDialog open={createWorkerOpen} onOpenChange={setCreateWorkerOpen} value={newWorker} onChange={setNewWorker} isPending={createWorker.isPending} modelOptions={modelOptions} sessionIssue={sessionIssue}
      onSubmit={() => createWorker.mutate(newWorker, { onSuccess: (created) => { setCreateWorkerOpen(false); setNewWorker(EMPTY_WORKER); if (created?.name) navigate('agents', 'agent', created.name); } })} />
    {forgingTeam && <MillforgeDialog open team={forgingTeam} workers={workers} canInstall={userLevel >= 3} modelAliases={modelOptions.map((option) => option.alias)} onOpenChange={(open) => !open && setMillforgeTeam(null)} onInjected={refresh} />}

    {/* 卡片「详情/编辑」入口（整改①，两个按钮必须落到不同 UI）：
        智能体详情 = 只读弹窗（复用 WorkerDetailDialog，传当前 worker 对象）；
        智能体编辑 = 编辑抽屉（WorkerDrawer，内含唯一实现 WorkerDetailPanel）；
        团队编辑 = 编辑弹窗（复用 TeamDetailDialog，chrome=full 暴露全部分区）。 */}
    <WorkerDetailDialog worker={detailWorker} onOpenChange={(open) => !open && setDetailWorker(null)} />
    <WorkerDrawer
      worker={editWorker}
      onOpenChange={(open) => !open && setEditWorker(null)}
      modelOptions={modelOptions}
      sessionIssue={sessionIssue}
      userLevel={userLevel}
      teams={teams}
      workers={workers}
      onChanged={refresh}
      onDeleted={() => { setEditWorker(null); navigate('agents'); }}
    />
    <TeamDetailDialog
      open={!!editTeam}
      onOpenChange={(open) => !open && setEditTeam(null)}
      team={editTeam}
      allTeams={teams}
      workers={workers}
      modelOptions={modelOptions}
      sessionIssue={sessionIssue}
      userLevel={userLevel}
      chrome="full"
      onChanged={refresh}
      onDeleted={() => { setEditTeam(null); navigate('teams'); }}
    />
  </div>;
}
