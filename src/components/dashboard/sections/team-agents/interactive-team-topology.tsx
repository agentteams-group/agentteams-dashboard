'use client';

import { useState } from 'react';
import { AlertTriangle, ArrowLeft, Loader2, Play, Settings, Users, WandSparkles } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { NativeSelect } from '@/components/ui/native-select';
import { Card, CardContent } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { useEnsureReadyWorker, useUpdateTeam } from '@/hooks/use-agentteams-mutations';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { teamHumanMembers, type TeamResponse, type WorkerResponse } from '@/lib/agentteams-api';
import { isUnsupportedEndpointError } from '@/lib/api-error';
import { cn } from '@/lib/utils';
import { TeamAssistantButton } from '../teams/team-assistant-button';
import { AccountAvatar } from '@/components/dashboard/account-avatar';
import { FilesBrowserPanel } from '../chat/views/worker-files-panel';
import { TeamUsersPanel } from '../teams/team-users-panel';
import { TeamSettingsPanel } from '../teams/team-settings-panel';
import { standaloneWorkers } from '../teams/team-drawer-logic';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { formatErrorMessage } from '@/lib/api-error';
import {
  ROLE_LABELS,
  isAbnormalPhase,
  memberSessionCount,
  shouldShowEnsureReady,
  teamAgentCounts,
  teamMembers,
} from './team-agents-logic';

export interface InteractiveTeamTopologyProps {
  team: TeamResponse;
  workers: WorkerResponse[] | undefined;
  /** 全局搜索词：团队名命中保留全部成员，成员名命中只保留命中行。 */
  searchQuery?: string;
  /** Agent 列表点进来的 Worker：行高亮，便于对照拓扑。 */
  highlightWorkerName?: string | null;
  onOpenWorker: (_worker: WorkerResponse) => void;
  onOpenTeamSettings: (_team: TeamResponse) => void;
  /** 团队头部设置旁的千锻入口。 */
  onOpenMillforge?: (_team: TeamResponse) => void;
  onOpenMembers?: () => void;
  inlinePanel?: string;
  onCloseInlinePanel?: () => void;
  allTeams?: TeamResponse[];
  modelOptions?: ModelSelectionOption[];
  sessionIssue?: string | null;
  onChanged?: () => void;
  /** narrow 单栏：返回团队列表。 */
  onBack?: () => void;
  /** Dashboard 会话等级：3 = 管理员（插件侧 L1），行内「拉起就绪」仅 L1 可见。 */
  userLevel?: number;
  /** 宿主布局类（工作台两栏模式传 "h-full" 让 Card 撑满中栏、成员列表内部滚动）。 */
  className?: string;
}

/**
 * 行内「拉起就绪」——L1-only，phase 非 Running/Ready 才显（B4）。
 * 独立子组件：mutation 钩子只在该按钮挂载时才跑（老控制器 404 → 隐藏，
 * 失败回落的 toast 由 useEnsureReadyWorker 统一发）。
 */
function MemberEnsureReadyButton({ workerName }: { workerName: string }) {
  const ensureReady = useEnsureReadyWorker();
  const [pending, setPending] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  if (unsupported) return null;
  return (
    <button
      type="button"
      title="拉起就绪"
      aria-label="拉起就绪"
      disabled={pending}
      onClick={(event) => {
        event.stopPropagation();
        setPending(true);
        ensureReady.mutate(workerName, {
          onError: (err) => {
            if (isUnsupportedEndpointError(err)) setUnsupported(true);
          },
          onSettled: () => setPending(false),
        });
      }}
      className="ml-1 inline-flex size-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
    >
      {pending ? (
        <Loader2 className="size-3 animate-spin" aria-hidden="true" />
      ) : (
        <Play className="size-3" aria-hidden="true" />
      )}
    </button>
  );
}

/**
 * 可交互团队拓扑（团队与Agent 合并页的唯一拓扑实现）。
 *
 * - leader 只从 Worker 列表解析（`team.leaderName` 是 Worker 名，不是 Manager）；
 * - `team.admin` 与普通用户单独展示在人类成员分区；
 * - 成员行是 div[role=button]（行内「拉起就绪」是嵌套按钮，HTML 不允许
 *   button 套 button）：点击 / Enter / Space 展示 Agent 详情；
 * - 描述、成员与设置均在中栏编辑，文件通过独立 Tab 浏览。
 */
export function InteractiveTeamTopology({
  team,
  workers,
  searchQuery = '',
  highlightWorkerName = null,
  onOpenWorker,
  onOpenTeamSettings,
  onOpenMillforge,
  onOpenMembers,
  inlinePanel,
  onCloseInlinePanel,
  allTeams,
  modelOptions = [],
  sessionIssue,
  onChanged,
  onBack,
  userLevel,
  className,
}: InteractiveTeamTopologyProps) {
  const updateTeam = useUpdateTeam();
  const [description, setDescription] = useState<string | null>(null);
  const [newAgent, setNewAgent] = useState('');
  const [editError, setEditError] = useState('');
  const availableAgents = standaloneWorkers(allTeams ?? [team], workers).filter(worker => !worker.team && worker.role !== 'manager');
  const saveDescription = async () => {
    try {
      setEditError('');
      await updateTeam.mutateAsync({ name: team.name, data: { description: description ?? team.description } });
      setDescription(null);
      onChanged?.();
    } catch (error) { setEditError(formatErrorMessage(error)); }
  };
  const addAgent = async () => {
    if (!availableAgents.some(worker => worker.name === newAgent)) return;
    try {
      setEditError('');
      await updateTeam.mutateAsync({ name: team.name, data: { leader: { name: team.leaderName }, workerNames: [...(team.workerNames ?? []), newAgent] } });
      setNewAgent('');
      onChanged?.();
    } catch (error) { setEditError(formatErrorMessage(error)); }
  };
  const allMembers = teamMembers(team, workers);
  const humansQuery = useHumans();
  const humans = humansQuery.data ?? [];
  const humanMembers = teamHumanMembers(team).filter(member => member.name !== team.admin?.name);
  for (const human of humans) {
    if (human.accessibleTeams?.includes(team.name) && human.name !== team.admin?.name && !humanMembers.some(member => member.name === human.name)) {
      humanMembers.push({ name: human.name, role: 'coordinator' });
    }
  }
  const people = [...(team.admin?.name ? [{ name: team.admin.name, role: 'admin' }] : []), ...humanMembers];
  const counts = teamAgentCounts(allMembers);
  const query = searchQuery.trim().toLowerCase();
  const teamHit =
    !query ||
    (team.name || '').toLowerCase().includes(query) ||
    (team.teamName || '').toLowerCase().includes(query) ||
    (team.description || '').toLowerCase().includes(query);

  const members = !query || teamHit
    ? allMembers
    : allMembers.filter(({ worker }) => worker.name.toLowerCase().includes(query));

  return (
    <Card role="region" aria-label="团队拓扑" className={cn('flex min-h-0 flex-col overflow-hidden rounded-xl border bg-card py-0 shadow-none', className)}>
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-0">
        <header
          data-testid="team-topology-header"
          className="flex flex-wrap items-center gap-3 border-b px-4 py-3"
        >
          {onBack && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 shrink-0 gap-1 px-2 text-xs"
              onClick={onBack}
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              团队列表
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Users className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
              <h2 className="truncate text-sm font-semibold" title={team.name}>{team.teamName || team.name}</h2>
              <PhaseBadge kind="team" phase={team.phase} className="shrink-0" />
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span>{counts.total} 个 Agent</span>
              <span aria-hidden="true">·</span>
              <span>
                就绪 {counts.ready}/{counts.total}
              </span>
              {counts.sleeping > 0 && (
                <span className="text-status-waiting">休眠 {counts.sleeping}</span>
              )}
              {counts.abnormal > 0 && (
                <span className="inline-flex items-center gap-1 text-destructive">
                  <AlertTriangle className="size-3" aria-hidden="true" />
                  异常 {counts.abnormal}
                </span>
              )}
            </p>
          </div>
          <div className="flex shrink-0 items-center gap-2">
          <TeamAssistantButton team={team} />
          {onOpenMillforge && <Button
            variant="outline"
            size="sm"
            aria-label="打开千锻"
            title={(userLevel ?? 0) < 3 ? '千锻注入需管理员（L1）权限' : '千锻'}
            disabled={(userLevel ?? 0) < 3}
            onClick={() => onOpenMillforge(team)}
          ><WandSparkles className="size-3.5" aria-hidden="true" />千锻</Button>}
          {/* 「查看团队详情」齿轮（≥44px 触控目标）：section 按布局分派——
              多栏选中该团队（常驻右栏 / dual 抽屉，不弹窗），single 开整面板。 */}
          <Button
            variant="outline"
            size="icon"
            className="min-h-11 min-w-11 shrink-0"
            aria-label="查看团队详情"
            title="查看团队详情"
            onClick={() => onOpenTeamSettings(team)}
          >
            <Settings className="size-4" aria-hidden="true" />
          </Button>
          </div>
        </header>

        {inlinePanel && inlinePanel !== 'users' ? <div className="flex min-h-0 flex-1 flex-col px-4 pb-4">
          <Button variant="ghost" size="sm" className="mb-3 w-fit" onClick={onCloseInlinePanel}><ArrowLeft />返回团队详情</Button>
          <TeamSettingsPanel key={team.name} team={team} allTeams={allTeams} workers={workers ?? []} modelOptions={modelOptions} sessionIssue={sessionIssue} userLevel={userLevel ?? 0} onChanged={onChanged} initialTab={inlinePanel === 'agents' || inlinePanel === 'team-skills' ? 'agents' : 'basic'} />
        </div> : <Tabs key={team.name} defaultValue="overview" className="min-h-0 flex-1 gap-3 px-4 pb-4">
          <TabsList aria-label="团队详情视图" className="shrink-0">
            <TabsTrigger value="overview">基础信息</TabsTrigger>
            <TabsTrigger value="files">团队文件</TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="min-h-0 space-y-5 overflow-y-auto overflow-x-hidden custom-scrollbar">
          <section aria-label="基础信息" className="space-y-2">
            {description !== null ? <div className="space-y-2">
              <Textarea aria-label="团队描述" value={description} onChange={event => setDescription(event.target.value)} disabled={updateTeam.isPending} />
              <div className="flex gap-2"><Button size="sm" disabled={updateTeam.isPending} onClick={() => void saveDescription()}>保存描述</Button><Button size="sm" variant="ghost" disabled={updateTeam.isPending} onClick={() => setDescription(null)}>取消</Button></div>
            </div> : <div className="flex items-start justify-between gap-2">
              <p className="text-sm leading-relaxed text-muted-foreground">{team.description || '暂无团队描述'}</p>
              {(userLevel ?? 0) >= 3 && <Button size="sm" variant="ghost" onClick={() => setDescription(team.description || '')}>编辑描述</Button>}
            </div>}
            {editError && <p role="alert" className="text-xs text-destructive">{editError}</p>}
            <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-lg bg-muted/30 p-3 text-xs">
              <div><dt className="text-muted-foreground">团队标识</dt><dd className="mt-1 break-all">{team.name}</dd></div>
              <div><dt className="text-muted-foreground">负责人</dt><dd className="mt-1 break-all">{team.leaderName || '未设置'}</dd></div>
              <div><dt className="text-muted-foreground">成员</dt><dd className="mt-1">{people.length} 位人类 · {counts.total} 个 Agent</dd></div>
              <div><dt className="text-muted-foreground">空闲休眠</dt><dd className="mt-1">{team.workerIdleTimeout || '默认策略'}</dd></div>
            </dl>
          </section>
          <section aria-label="Agent 成员" className="space-y-2">
          <h3 className="text-sm font-semibold">Agent 成员 <span className="ml-1 font-normal text-muted-foreground">{counts.total}</span></h3>
          {query && !teamHit && (
            <p className="px-1 pb-1 text-xs text-muted-foreground" role="status">
              匹配 {members.length} / {allMembers.length} 名成员
            </p>
          )}
          {(userLevel ?? 0) >= 3 && <div className="flex flex-wrap items-center gap-2 pt-2">
            <NativeSelect aria-label="添加未归属团队的 Agent" value={newAgent} disabled={updateTeam.isPending || availableAgents.length === 0} className="h-9 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs" onChange={event => setNewAgent(event.target.value)}>
              <option value="">{availableAgents.length ? '选择未归属团队的 Agent…' : '暂无未归属团队的 Agent'}</option>
              {availableAgents.map(worker => <option key={worker.name} value={worker.name}>{worker.name} · {worker.model}</option>)}
            </NativeSelect>
            <Button size="sm" variant="outline" disabled={!newAgent || updateTeam.isPending} onClick={() => void addAgent()}>添加 Agent</Button>
          </div>}
          {members.length === 0 ? (
            <p className="px-2 py-8 text-center text-xs text-muted-foreground">
              {allMembers.length === 0 ? '暂无成员' : '没有匹配的成员'}
            </p>
          ) : (
            <ul className="space-y-0.5" aria-label={`${team.name} 成员`}>
              {members.map(({ worker, role }) => {
                const abnormal = isAbnormalPhase(worker.phase);
                const sessions = memberSessionCount(worker);
                const highlighted = highlightWorkerName === worker.name;
                const showEnsureReady = (userLevel ?? 0) >= 3 && shouldShowEnsureReady(worker.phase);
                return (
                  <li key={worker.name} className="min-w-0">
                    <div
                      role="button"
                      tabIndex={0}
                      data-worker-name={worker.name}
                      data-role={role}
                      data-highlighted={highlighted || undefined}
                      onClick={() => onOpenWorker(worker)}
                      onKeyDown={(event) => {
                        if (event.key !== 'Enter' && event.key !== ' ') return;
                        event.preventDefault();
                        onOpenWorker(worker);
                      }}
                      className={`flex min-h-11 w-full min-w-0 cursor-pointer items-center gap-2 rounded-lg border px-2 py-1.5 text-left transition-colors focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                        highlighted
                          ? 'border-border bg-muted/50'
                          : 'border-transparent hover:bg-muted/50'
                      }`}
                    >
                      <Avatar className="size-7 shrink-0">
                        <AvatarFallback className="text-xs">
                          {worker.name.slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <span
                          className={`truncate text-xs hover:underline ${role === 'leader' ? 'font-semibold' : 'font-medium'}`}
                        >
                          {worker.name}
                        </span>
                        <Badge
                          variant="outline"
                          className="shrink-0 border-border bg-muted/40 text-xs text-muted-foreground"
                        >
                          {ROLE_LABELS[role]}
                        </Badge>
                      </span>
                      <span className="mt-1 block truncate text-xs text-muted-foreground" title={`${worker.runtime} · ${worker.model}`}>{worker.runtime} · {worker.model}</span>
                      </span>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground">
                        {worker.runningTaskCount != null && worker.runningTaskCount > 0 && (
                          <span className="tabular-nums">在跑 {worker.runningTaskCount}</span>
                        )}
                        {sessions !== undefined && (
                          <span className="tabular-nums">{sessions} 会话</span>
                        )}
                        {abnormal && (
                          <span className="inline-flex items-center gap-0.5 text-destructive">
                            <AlertTriangle className="size-3" aria-hidden="true" />
                            异常
                          </span>
                        )}
                        <PhaseBadge kind="worker" phase={worker.phase} />
                      </span>
                      {showEnsureReady && <MemberEnsureReadyButton workerName={worker.name} />}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          </section>
          <section aria-label="人类成员" className="space-y-2 border-t pt-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold">人类成员 <span className="ml-1 font-normal text-muted-foreground">{people.length}</span></h3>
              {onOpenMembers && (userLevel ?? 0) >= 3 && <Button size="sm" variant="outline" onClick={inlinePanel === 'users' ? onCloseInlinePanel : onOpenMembers}>{inlinePanel === 'users' ? '收起管理' : '管理成员'}</Button>}
            </div>
            {inlinePanel === 'users' ? <TeamUsersPanel key={team.name} team={team} onChanged={onChanged} /> : <>
            <ul className="space-y-1" aria-label="团队人类成员">
              {people.map(person => {
                const displayName = humans.find(human => human.name === person.name)?.displayName || person.name;
                return <li key={person.name} className="flex items-center gap-2 py-2 text-xs">
                <AccountAvatar kind="human" name={person.name} className="size-7 shrink-0" />
                <span className="min-w-0 flex-1"><span className="block truncate font-medium">{displayName}</span>{displayName !== person.name && <span className="block truncate text-muted-foreground">{person.name}</span>}</span>
                <Badge variant="outline">{person.role === 'admin' ? '管理员' : person.role === 'coordinator' ? '协调用户' : '成员'}</Badge>
              </li>; })}
            </ul>
            {humansQuery.isError && <p role="alert" className="text-xs text-muted-foreground">部分用户信息加载失败</p>}
            {people.length === 0 && <p className="py-2 text-xs text-muted-foreground">暂无人类成员</p>}
            </>}
          </section>
          </TabsContent>
          <TabsContent value="files" className="min-h-0 overflow-hidden">
            <FilesBrowserPanel scope={{ team: team.name }} readOnly />
          </TabsContent>
        </Tabs>}
      </CardContent>
    </Card>
  );
}
