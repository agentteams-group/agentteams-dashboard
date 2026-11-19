import { useState } from 'react';
import { Bot, Crown, Users } from 'lucide-react';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { Button } from '@/components/ui/button';
import type { WorkerResponse } from '@/lib/agentteams-api';
import { ROLE_LABELS, teamMembers, type TeamAgentRow } from './team-agents-logic';

type TeamTopologyViewProps = {
  rows: TeamAgentRow[];
  workers: WorkerResponse[];
  hasSearch: boolean;
  onOpenTeam: (_name: string) => void;
  onOpenWorker: (_name: string) => void;
};

export function TeamTopologyView({ rows, workers, hasSearch, onOpenTeam, onOpenWorker }: TeamTopologyViewProps) {
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const selected = rows.find(({ team }) => team.name === selectedName) ?? rows[0];
  if (!selected) {
    return <p className="py-12 text-sm text-muted-foreground">{hasSearch ? '没有匹配的团队' : '暂无团队，创建团队开始协作。'}</p>;
  }

  const { team, matchedMembers } = selected;
  const members = teamMembers(team, workers);
  const leader = members.find(({ role }) => role === 'leader')?.worker;
  const otherMembers = members.filter(({ role }) => role !== 'leader');
  const teamName = team.teamName || team.name;

  return (
    <section aria-label="团队拓扑" className="@container">
      <div className="grid min-w-0 gap-4 @min-[680px]:grid-cols-[minmax(180px,240px)_minmax(0,1fr)]">
        <div role="group" aria-label="选择团队" className="flex min-w-0 gap-1 overflow-x-auto rounded-xl border bg-card p-2 @min-[680px]:flex-col">
          {rows.map(({ team: item }) => (
            <Button key={item.name} size="sm" variant={item.name === team.name ? 'secondary' : 'ghost'}
              aria-pressed={item.name === team.name} className="min-w-0 max-w-full shrink-0 justify-start"
              onClick={() => setSelectedName(item.name)}>
              <Users className="size-4" aria-hidden="true" />
              <span className="truncate" title={item.teamName || item.name}>{item.teamName || item.name}</span>
            </Button>
          ))}
        </div>

        <div role="group" aria-label={`${teamName} 拓扑图`} className="min-w-0 rounded-xl border bg-card p-4">
          <div className="flex min-w-0 flex-col items-center">
            <Button variant="outline" className="h-auto min-h-9 max-w-full flex-wrap" onClick={() => onOpenTeam(team.name)}>
              <Users className="size-4" aria-hidden="true" />
              <span className="min-w-0 break-all">{teamName}</span>
              <PhaseBadge kind="team" phase={team.phase} />
            </Button>
            <span aria-hidden="true" className="h-6 w-px bg-border" />
            {leader ? (
              <Button variant="outline" className="h-auto min-h-9 max-w-full flex-wrap" onClick={() => onOpenWorker(leader.name)}>
                <Crown className="size-4" aria-hidden="true" />
                <span className="min-w-0 break-all">{leader.name}</span>
                <span className="text-xs text-muted-foreground">负责人</span>
              </Button>
            ) : (
              <p className="max-w-full break-all rounded-lg border px-3 py-2 text-sm text-muted-foreground">
                {team.leaderName ? `负责人 · ${team.leaderName}` : '未指定负责人'}
              </p>
            )}
            {otherMembers.length > 0 ? (
              <>
                <span aria-hidden="true" className="h-6 w-px bg-border" />
                <ul aria-label="团队成员" className="flex max-w-full flex-wrap justify-center gap-2 rounded-lg border p-2">
                  {otherMembers.map(({ worker, role }) => (
                    <li key={worker.name} className="min-w-0 max-w-full">
                      <Button
                        variant={matchedMembers.includes(worker.name) ? 'secondary' : 'outline'}
                        size="sm"
                        className="h-auto min-h-8 max-w-full flex-wrap"
                        onClick={() => onOpenWorker(worker.name)}
                      >
                        <Bot className="size-4" aria-hidden="true" />
                        <span className="min-w-0 break-all">{worker.name}</span>
                        <span className="text-xs text-muted-foreground">{ROLE_LABELS[role]}</span>
                      </Button>
                    </li>
                  ))}
                </ul>
              </>
            ) : <p className="mt-3 text-xs text-muted-foreground">暂无其他团队成员</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
