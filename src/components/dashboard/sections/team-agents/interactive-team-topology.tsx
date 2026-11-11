'use client';

import { AlertTriangle, ArrowLeft, Bot, Settings, Users } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { StatusDot } from '@/components/dashboard/status-dot';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import {
  ROLE_LABELS,
  isAbnormalPhase,
  leaderWorker,
  memberSessionCount,
  teamAgentCounts,
  teamHealthLabel,
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
  /** narrow 单栏：返回团队列表。 */
  onBack?: () => void;
}

function roleBadgeClass(role: 'leader' | 'critic' | 'worker'): string {
  if (role === 'leader') return 'border-primary/40 bg-primary/10 text-primary';
  if (role === 'critic') return 'border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400';
  return 'border-border bg-muted/40 text-muted-foreground';
}

/**
 * 可交互团队拓扑（团队与Agent 合并页的唯一拓扑实现）。
 *
 * - leader 只从 Worker 列表解析（`team.leaderName` 是 Worker 名，不是 Manager）；
 * - Manager 展示用 `team.admin`；
 * - 成员行是原生 button：点击 / Enter / Space 打开既有 WorkerDrawer；
 * - 头部齿轮打开既有 TeamDrawer（团队设置）。
 */
export function InteractiveTeamTopology({
  team,
  workers,
  searchQuery = '',
  highlightWorkerName = null,
  onOpenWorker,
  onOpenTeamSettings,
  onBack,
}: InteractiveTeamTopologyProps) {
  const allMembers = teamMembers(team, workers);
  const counts = teamAgentCounts(allMembers);
  const leader = leaderWorker(team, workers);
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
    <Card className="glass-card flex min-h-0 flex-col overflow-hidden">
      <CardContent className="flex min-h-0 flex-1 flex-col gap-3 p-0">
        <header
          data-testid="team-topology-header"
          className="flex flex-wrap items-start gap-2 border-b px-3 py-2.5"
        >
          {onBack && (
            <Button
              variant="ghost"
              size="sm"
              className="min-h-11 shrink-0 gap-1 px-2 text-xs md:hidden"
              onClick={onBack}
            >
              <ArrowLeft className="size-3.5" aria-hidden="true" />
              团队列表
            </Button>
          )}
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
              <Users className="size-4 shrink-0 text-status-done" aria-hidden="true" />
              <h2 className="truncate text-sm font-semibold">{team.name}</h2>
              <PhaseBadge kind="team" phase={team.phase} className="shrink-0" />
              <Badge variant="outline" className="shrink-0 text-xs">
                {teamHealthLabel(counts)}
              </Badge>
              {team.admin?.name && (
                <Badge variant="outline" className="shrink-0 text-xs">
                  Manager · {team.admin.name}
                </Badge>
              )}
            </div>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs text-muted-foreground">
              <span className="inline-flex items-center gap-1">
                <StatusDot phase={leader?.phase ?? team.phase} />
                Leader {leader?.name ?? team.leaderName ?? '未指定'}
              </span>
              <span aria-hidden="true">·</span>
              <span>{counts.total} 名成员</span>
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
              {team.teamName && team.teamName !== team.name && (
                <span className="truncate">{team.teamName}</span>
              )}
            </p>
          </div>
          <Button
            variant="outline"
            size="icon"
            className="min-h-11 min-w-11 shrink-0"
            aria-label="团队设置"
            title="团队设置"
            onClick={() => onOpenTeamSettings(team)}
          >
            <Settings className="size-4" aria-hidden="true" />
          </Button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-2 custom-scrollbar">
          {query && !teamHit && (
            <p className="px-1 pb-1 text-xs text-muted-foreground" role="status">
              匹配 {members.length} / {allMembers.length} 名成员
            </p>
          )}
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
                return (
                  <li key={worker.name} className="min-w-0">
                    <button
                      type="button"
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
                          ? 'border-primary/50 bg-primary/5'
                          : 'border-transparent hover:bg-muted/50'
                      }`}
                    >
                      <Avatar className="size-7 shrink-0">
                        <AvatarFallback className="text-xs">
                          {worker.name.slice(0, 1).toUpperCase()}
                        </AvatarFallback>
                      </Avatar>
                      <span className="flex min-w-0 flex-1 flex-wrap items-center gap-x-1.5 gap-y-0.5">
                        <span
                          className={`truncate text-xs ${role === 'leader' ? 'font-semibold' : 'font-medium'}`}
                        >
                          {worker.name}
                        </span>
                        <Badge
                          variant="outline"
                          className={`shrink-0 text-xs ${roleBadgeClass(role)}`}
                        >
                          {ROLE_LABELS[role]}
                        </Badge>
                        {worker.team && (
                          <span className="inline-flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
                            <Bot className="size-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{worker.team}</span>
                          </span>
                        )}
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
                        <StatusDot phase={worker.phase} />
                        <PhaseBadge kind="worker" phase={worker.phase} />
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
