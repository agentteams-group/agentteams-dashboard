'use client';

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SectionHeader } from '@/components/dashboard/section-header';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
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
import { PERMISSION_LABELS } from '../humans/human-types';

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

function MemberLink({ name, label, summary, onOpen }: {
  name: string; label?: string; summary: string[]; onOpen: () => void;
}) {
  return <Tooltip><TooltipTrigger asChild>
    <button type="button" onClick={onOpen} className="inline-flex max-w-full items-center rounded-md border bg-muted/20 px-2 py-1 text-xs transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`查看 ${name} 的主页`}>
      <span className="truncate">{label || name}</span>
    </button>
  </TooltipTrigger><TooltipContent side="bottom" className="max-w-72 space-y-1 p-3 text-xs">
    <p className="font-medium">{label || name}</p>{summary.map((line) => <p key={line}>{line}</p>)}
    <p className="pt-1 opacity-70">点击查看主页</p>
  </TooltipContent></Tooltip>;
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
  const agents = [
    ...managers.map((manager) => ({ ...manager, kind: 'manager' as const, team: '', label: '平台助手 · Manager' })),
    ...workers.map((worker) => ({ ...worker, kind: 'agent' as const, label: teams.some((team) => team.leaderName === worker.name) ? '团队负责人 · Leader' : '执行成员 · Worker' })),
  ].filter((agent) => [agent.name, agent.model, agent.runtime, agent.team].some((value) => value?.toLowerCase().includes(query)))
    .sort((a, b) => Number(b.kind === 'manager') - Number(a.kind === 'manager') || a.name.localeCompare(b.name));
  const selectedTeam = teams.find((team) => team.name === location.team);
  const selectedWorker = workers.find((worker) => worker.name === location.agent);
  const selectedManager = managers.find((manager) => manager.name === location.manager);
  const isDetail = Boolean(location.team || location.agent || location.manager);
  const forgingTeam = teams.find((team) => team.name === millforgeTeam);

  function humanChip(name: string) {
    const human = humans?.find((item) => item.name === name);
    return <MemberLink key={name} name={name} label={human?.displayName}
      summary={[name, human?.email || '', human?.permissionLevel ? PERMISSION_LABELS[human.permissionLevel] : '人类成员'].filter(Boolean)}
      onOpen={() => openResource(`${hashForSection('humans')}?human=${encodeURIComponent(name)}`)} />;
  }
  function agentChip(name: string) {
    const worker = workers.find((item) => item.name === name);
    return <MemberLink key={name} name={name}
      summary={[`模型 · ${worker?.model || '未设置'}`, `运行时 · ${worker?.runtime || '未知'}`, `状态 · ${worker?.phase || '未知'}`]}
      onOpen={() => navigate('agents', 'agent', name)} />;
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
        <h2 className="font-medium">{location.edit ? '编辑' : '主页'} · {selectedTeam?.teamName || location.team || location.agent || location.manager}</h2>
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
        location.tab === 'teams' ? <div className="grid gap-4 xl:grid-cols-2" aria-label="团队卡片">
          {teamRows.map(({ team }) => {
            const members = [...new Set([...(team.humanMembers ?? []), ...(humans ?? []).filter((human) => human.accessibleTeams?.includes(team.name)).map((human) => human.name)])].filter((name) => name !== team.admin?.name).sort((a, b) => a.localeCompare(b));
            const teamWorkers = teamMemberWorkers(team, workers).filter((worker) => worker.name !== team.leaderName);
            return <Card key={team.name} className="gap-0 rounded-xl py-0 shadow-none"><CardContent className="space-y-4 p-5">
              <div className="flex items-start justify-between gap-3"><div className="min-w-0">
                <button onClick={() => navigate('teams', 'team', team.name)} className="text-left font-semibold hover:underline">{team.teamName || team.name}</button>
                {team.teamName && team.teamName !== team.name && <p className="mt-1 text-xs text-muted-foreground">{team.name}</p>}
              </div><PhaseBadge kind="team" phase={team.phase} /></div>
              {team.description && <p className="line-clamp-2 text-sm leading-6 text-muted-foreground">{team.description}</p>}
              <dl className="grid grid-cols-[auto_minmax(0,1fr)] items-start gap-x-4 gap-y-3 text-sm">
                <dt className="pt-1 text-muted-foreground">Team Admin</dt><dd>{team.admin?.name ? humanChip(team.admin.name) : '未设置'}</dd>
                <dt className="pt-1 text-muted-foreground">普通成员 · {members.length}</dt><dd className="flex flex-wrap gap-1.5">{members.length ? members.map(humanChip) : <span className="text-muted-foreground">暂无普通成员</span>}</dd>
                <dt className="pt-1 text-muted-foreground">Leader</dt><dd>{team.leaderName ? agentChip(team.leaderName) : '未设置'}</dd>
                <dt className="pt-1 text-muted-foreground">Workers · {teamWorkers.length}</dt><dd className="flex flex-wrap gap-1.5">{teamWorkers.length ? teamWorkers.map((worker) => agentChip(worker.name)) : <span className="text-muted-foreground">暂无 Worker</span>}</dd>
              </dl>
              <div className="flex justify-end gap-2 border-t pt-3"><Button variant="ghost" size="sm" onClick={() => navigate('teams', 'team', team.name)}>查看详情</Button><Button variant="outline" size="sm" onClick={() => navigate('teams', 'team', team.name, true)}>编辑团队</Button></div>
            </CardContent></Card>;
          })}
          {teamRows.length === 0 && <p className="py-12 text-sm text-muted-foreground">{query ? '没有匹配的团队' : '暂无团队，创建团队开始协作。'}</p>}
        </div> : <div className="grid gap-4 md:grid-cols-2 2xl:grid-cols-3" aria-label="Agent 卡片">
          {agents.map((agent) => <Card key={`${agent.kind}-${agent.name}`} className="gap-0 rounded-xl py-0 shadow-none"><CardContent className="space-y-4 p-5">
            <div className="flex items-center justify-between gap-3"><h2 className="truncate font-semibold">{agent.name}</h2><PhaseBadge kind={agent.kind === 'manager' ? 'manager' : 'worker'} phase={agent.phase} /></div>
            <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm"><dt className="text-muted-foreground">角色</dt><dd>{agent.label}</dd><dt className="text-muted-foreground">模型</dt><dd className="break-all font-medium">{agent.model || '未设置'}</dd><dt className="text-muted-foreground">运行时</dt><dd>{agent.runtime}</dd><dt className="text-muted-foreground">所属团队</dt><dd className="truncate">{agent.kind === 'manager' ? '平台' : agent.team || '独立 Agent'}</dd></dl>
            <div className="flex justify-end gap-2 border-t pt-3"><Button variant="ghost" size="sm" onClick={() => navigate('agents', agent.kind, agent.name)}>查看详情</Button><Button variant="outline" size="sm" onClick={() => navigate('agents', agent.kind, agent.name, true)}>编辑</Button></div>
          </CardContent></Card>)}
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
