'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SectionHeader } from '@/components/dashboard/section-header';
import { OverflowText } from '@/components/dashboard/overflow-text';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { useCreateTeam, useCreateWorker } from '@/hooks/use-agentteams-mutations';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useModelSelection } from '@/hooks/use-model-selection';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useSearch } from '@/lib/search-context';
import { currentHashParams, hashForSection, type TeamAgentsTab } from '@/lib/nav-hash';
import type { CreateTeamRequest, CreateWorkerRequest } from '@/lib/agentteams-api';
import { ManagerDetailPanel } from '../managers/manager-detail-panel';
import { TeamCreateDialog } from '../teams/team-create-dialog';
import { TeamSettingsPanel } from '../teams/team-settings-panel';
import { MillforgeDialog } from '../teams/millforge/millforge-dialog';
import { WorkerCreateDialog } from '../workers/worker-create-dialog';
import { WorkerDetailPanel } from '../workers/worker-detail-panel';
import { filterTeamRows, teamMemberWorkers, teamAgentsInitialIntentFromHash } from './team-agents-logic';
import { MemberPreview } from './member-preview';
import { AgentSummaryCard, HumanSummaryCard, ResourceIdentity } from './resource-summary-card';

const RESOURCE_CARD_GRID = 'grid grid-cols-[repeat(auto-fill,minmax(min(100%,300px),1fr))] items-start gap-5';

const EMPTY_TEAM: CreateTeamRequest = { name: '', leader: { name: '' }, workerNames: [] };
const EMPTY_WORKER: CreateWorkerRequest = { name: '', runtime: 'openclaw' };

function openResource(hash: string) {
  window.location.hash = hash;
}

function readLocation() {
  const params = currentHashParams();
  return {
    tab: (typeof window === 'undefined' ? 'teams' : teamAgentsInitialIntentFromHash(window.location.hash)) as TeamAgentsTab,
    team: params?.get('team') ?? null, agent: params?.get('agent') ?? null,
    manager: params?.get('manager') ?? null, edit: params?.get('edit') === 'true',
  };
}

export function TeamAgentsSection() {
  const teamsQuery = useTeams();
  const workersQuery = useWorkers();
  const { data: managers = [] } = useManagers();
  const { data: humans } = useHumans();
  const { searchQuery } = useSearch();
  const { isConnected, userLevel } = useAgentTeamsStore();
  const { options: modelOptions, sessionIssue } = useModelSelection();
  const queryClient = useQueryClient();
  const createTeam = useCreateTeam();
  const createWorker = useCreateWorker();
  const [location, setLocation] = useState<ReturnType<typeof readLocation>>({ tab: 'teams', team: null, agent: null, manager: null, edit: false });
  const [search, setSearch] = useState('');
  const [createTeamOpen, setCreateTeamOpen] = useState(false);
  const [createWorkerOpen, setCreateWorkerOpen] = useState(false);
  const [newTeam, setNewTeam] = useState<CreateTeamRequest>(EMPTY_TEAM);
  const [newWorker, setNewWorker] = useState<CreateWorkerRequest>(EMPTY_WORKER);
  const [millforgeTeam, setMillforgeTeam] = useState<string | null>(null);

  useEffect(() => {
    const sync = () => setLocation(readLocation());
    sync();
    window.addEventListener('hashchange', sync);
    return () => window.removeEventListener('hashchange', sync);
  }, []);

  function navigate(tab: TeamAgentsTab, kind?: 'team' | 'agent' | 'manager', name?: string, edit = false) {
    const params = new URLSearchParams({ tab });
    if (kind && name) params.set(kind, name);
    if (edit) params.set('edit', 'true');
    openResource(`${hashForSection('team-agents')}?${params}`);
    setLocation(readLocation());
  }
  function refresh() {
    void teamsQuery.refetch();
    for (const key of ['agentteams-workers', 'agentteams-managers', 'agentteams-humans']) {
      void queryClient.invalidateQueries({ queryKey: [key] });
    }
  }

  const teams = teamsQuery.data ?? [];
  const workers = workersQuery.data ?? [];
  const query = `${searchQuery} ${search}`.trim().toLowerCase();
  const teamRows = filterTeamRows(teams, workers, query);
  const allAgents = [
    ...managers.map((manager) => ({ ...manager, kind: 'manager' as const, team: '', label: '平台助手 · Manager' })),
    ...workers.map((worker) => ({ ...worker, kind: 'agent' as const, label: teams.some((team) => team.leaderName === worker.name) ? '团队负责人 · Leader' : '执行成员 · Worker' })),
  ].sort((a, b) => Number(b.kind === 'manager') - Number(a.kind === 'manager') || a.name.localeCompare(b.name));
  const agents = allAgents.filter((agent) => [agent.name, agent.model, agent.runtime, agent.team].some((value) => value?.toLowerCase().includes(query)));
  const selectedTeam = teams.find((team) => team.name === location.team);
  const selectedWorker = workers.find((worker) => worker.name === location.agent);
  const selectedManager = managers.find((manager) => manager.name === location.manager);
  const isDetail = Boolean(location.team || location.agent || location.manager);
  const forgingTeam = teams.find((team) => team.name === millforgeTeam);

  function humanChip(name: string) {
    const human = humans?.find((item) => item.name === name);
    const onView = () => openResource(`${hashForSection('humans')}?human=${encodeURIComponent(name)}`);
    return <MemberPreview key={name} name={name} label={human?.displayName} onOpen={onView}>
      <HumanSummaryCard name={name} human={human} onView={onView} />
    </MemberPreview>;
  }
  function agentChip(name: string) {
    const agent = allAgents.find((item) => item.kind === 'agent' && item.name === name)
      ?? { name, model: '', runtime: '', phase: '', team: '', kind: 'agent' as const, label: 'Worker' };
    const onView = () => navigate('agents', 'agent', name);
    return <MemberPreview key={name} name={name} onOpen={onView}>
      <AgentSummaryCard agent={agent} onView={onView} onEdit={() => navigate('agents', 'agent', name, true)} />
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

  return <div className="space-y-4" data-testid="team-agents-section">
    <SectionHeader title="团队与 Agent" onRefresh={refresh} isRefreshing={teamsQuery.isRefetching}
      meta={<Tabs value={location.tab} onValueChange={(value) => navigate(value as TeamAgentsTab)}><TabsList aria-label="资源分类">
        <TabsTrigger value="teams">团队 <span className="text-muted-foreground tabular-nums">{teams.length}</span></TabsTrigger>
        <TabsTrigger value="agents">Agent <span className="text-muted-foreground tabular-nums">{workers.length + managers.length}</span></TabsTrigger>
      </TabsList></Tabs>}
      actions={isDetail ? <Button size="sm" variant="outline" onClick={() => navigate(location.tab)}>返回列表</Button> :
        <Button size="sm" onClick={() => location.tab === 'teams' ? setCreateTeamOpen(true) : setCreateWorkerOpen(true)}>{location.tab === 'teams' ? '创建团队' : '创建 Agent'}</Button>} />

    {isDetail ? <div className="flex h-[calc(100dvh-15rem)] min-h-[420px] flex-col rounded-xl border bg-card">
      <div className="flex items-center justify-between gap-3 border-b px-5 py-3">
        <h2 className="min-w-0 font-medium"><OverflowText text={`${location.edit ? '编辑' : '主页'} · ${selectedTeam?.teamName || location.team || location.agent || location.manager}`} /></h2>
        {selectedTeam && <Button size="sm" variant="outline" onClick={() => setMillforgeTeam(selectedTeam.name)}>千锻 · 团队配置</Button>}
      </div>
      {selectedTeam ? <TeamSettingsPanel key={selectedTeam.name} team={selectedTeam} allTeams={teams} workers={workers} modelOptions={modelOptions} sessionIssue={sessionIssue} userLevel={userLevel} onChanged={refresh} onDeleted={() => navigate('teams')} /> :
        selectedWorker ? <WorkerDetailPanel key={selectedWorker.name} worker={selectedWorker} modelOptions={modelOptions} sessionIssue={sessionIssue} userLevel={userLevel} className="min-h-0 flex-1" onChanged={refresh} onDeleted={() => navigate('agents')} /> :
          selectedManager ? <ManagerDetailPanel key={selectedManager.name} manager={selectedManager} modelOptions={modelOptions} sessionIssue={sessionIssue} userLevel={userLevel} className="min-h-0 flex-1" onChanged={refresh} /> :
            <p className="p-6 text-sm text-muted-foreground">{teamsQuery.isLoading || workersQuery.isLoading ? '正在加载…' : '未找到该资源，请返回列表刷新。'}</p>}
    </div> : <>
      <div className="flex flex-wrap items-center gap-3">
        <Input className="h-9 w-full sm:max-w-sm" aria-label="搜索团队或 Agent" placeholder={location.tab === 'teams' ? '搜索团队或成员…' : '搜索名称、模型或运行时…'} value={search} onChange={(event) => setSearch(event.target.value)} />
        <span className="text-xs text-muted-foreground">{location.tab === 'teams' ? '人类成员与 Agent 分别展示 · 悬停查看概要' : 'Manager 与 Worker · 点击查看主页或编辑配置'}</span>
      </div>
      {teamsQuery.isLoading || workersQuery.isLoading ? <div className="grid gap-4 md:grid-cols-2">{[0, 1].map((item) => <div key={item} className="h-56 rounded-xl border bg-muted/30 animate-pulse" />)}</div> :
        location.tab === 'teams' ? <div className={RESOURCE_CARD_GRID} aria-label="团队卡片">
          {teamRows.map(({ team }) => {
            const members = [...new Set([...(team.humanMembers ?? []), ...(humans ?? []).filter((human) => human.accessibleTeams?.includes(team.name)).map((human) => human.name)])].filter((name) => name !== team.admin?.name).sort((a, b) => a.localeCompare(b));
            const teamWorkers = teamMemberWorkers(team, workers).filter((worker) => worker.name !== team.leaderName);
            return <Card key={team.name} className="min-w-0 w-full max-w-[360px] gap-0 overflow-hidden rounded-2xl border-border/80 py-0 shadow-sm transition-shadow hover:shadow-md"><CardContent className="space-y-4 p-5">
              <ResourceIdentity name={team.teamName || team.name} role={`团队 · ${members.length + (team.admin?.name ? 1 : 0)} 人 · ${teamWorkers.length + (team.leaderName ? 1 : 0)} Agent`} kind="team" phase={team.phase} onView={() => navigate('teams', 'team', team.name)} />
              <OverflowText text={team.description || ''} multiline className="h-10 text-xs leading-5 text-muted-foreground" />
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 text-sm">
                <dt className="pt-1 text-muted-foreground">Team Admin</dt><dd className="h-7 min-w-0">{team.admin?.name ? humanChip(team.admin.name) : '未设置'}</dd>
                <dt className="pt-1 text-muted-foreground">普通成员 · {members.length}</dt><dd className="h-7 min-w-0">{members.length ? memberList(members, humanChip, `${team.teamName || team.name}的普通成员`, '普通成员') : <span className="text-muted-foreground">暂无普通成员</span>}</dd>
                <dt className="pt-1 text-muted-foreground">Leader</dt><dd className="h-7 min-w-0">{team.leaderName ? agentChip(team.leaderName) : '未设置'}</dd>
                <dt className="pt-1 text-muted-foreground">Workers · {teamWorkers.length}</dt><dd className="h-7 min-w-0">{teamWorkers.length ? memberList(teamWorkers.map((worker) => worker.name), agentChip, `${team.teamName || team.name}的 Workers`, 'Workers') : <span className="text-muted-foreground">暂无 Worker</span>}</dd>
              </dl>
              <div className="flex justify-end gap-2 border-t pt-3"><Button variant="ghost" size="sm" onClick={() => navigate('teams', 'team', team.name)}>查看详情</Button><Button variant="outline" size="sm" onClick={() => navigate('teams', 'team', team.name, true)}>编辑团队</Button></div>
            </CardContent></Card>;
          })}
          {teamRows.length === 0 && <p className="py-12 text-sm text-muted-foreground">{query ? '没有匹配的团队' : '暂无团队，创建团队开始协作。'}</p>}
        </div> : <div className={RESOURCE_CARD_GRID} aria-label="Agent 卡片">
          {agents.map((agent) => <AgentSummaryCard key={`${agent.kind}-${agent.name}`} agent={agent}
            onView={() => navigate('agents', agent.kind, agent.name)}
            onEdit={() => navigate('agents', agent.kind, agent.name, true)} />)}
          {agents.length === 0 && <p className="py-12 text-sm text-muted-foreground">{query ? '没有匹配的 Agent' : '暂无 Agent'}</p>}
        </div>}
    </>}

    <TeamCreateDialog open={createTeamOpen} onOpenChange={setCreateTeamOpen} value={newTeam} onChange={setNewTeam} isPending={createTeam.isPending} workers={workers} modelOptions={modelOptions} sessionIssue={sessionIssue} onWorkerCreated={refresh}
      onSubmit={() => createTeam.mutate(newTeam, { onSuccess: (created) => { setCreateTeamOpen(false); setNewTeam(EMPTY_TEAM); if (created?.name) navigate('teams', 'team', created.name); } })} />
    <WorkerCreateDialog open={createWorkerOpen} onOpenChange={setCreateWorkerOpen} value={newWorker} onChange={setNewWorker} isPending={createWorker.isPending} modelOptions={modelOptions} sessionIssue={sessionIssue}
      onSubmit={() => createWorker.mutate(newWorker, { onSuccess: (created) => { setCreateWorkerOpen(false); setNewWorker(EMPTY_WORKER); if (created?.name) navigate('agents', 'agent', created.name); } })} />
    {forgingTeam && <MillforgeDialog open team={forgingTeam} workers={workers} canInstall={userLevel >= 3} modelAliases={modelOptions.map((option) => option.alias)} onOpenChange={(open) => !open && setMillforgeTeam(null)} onInjected={refresh} />}
  </div>;
}
