'use client';

import { Bot, Users } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { TeamHealthPanel } from './team-health-panel';
import type { TeamResponse, WorkerResponse } from '@/lib/hiclaw-api';
import { getWorkersForTeam } from './team-selectors';

const DETAIL_FIELDS: Array<[string, (_t: TeamResponse) => string]> = [
  ['名称', (t) => t.name],
  ['团队名称', (t) => t.teamName || '-'],
  ['描述', (t) => t.description || '-'],
  ['Leader', (t) => t.leaderName || '-'],
  ['Leader 就绪', (t) => (t.leaderReady ? '是' : '否')],
  ['Workers', (t) => `${t.readyWorkers}/${t.totalWorkers}`],
  ['人类成员', (t) => (t.humanMembers || []).join(', ') || '-'],
  ['Worker 列表', (t) => (t.workerNames || []).join(', ') || '-'],
  ['团队房间', (t) => t.teamRoomID || '-'],
  ['Leader DM 房间', (t) => t.leaderDMRoomID || '-'],
  ['空闲超时', (t) => t.workerIdleTimeout || '-'],
  ['消息', (t) => t.message || '-'],
];

function TeamWorkersList({
  teamName,
  workers,
}: {
  teamName: string;
  workers: WorkerResponse[];
}) {
  const teamWorkers = getWorkersForTeam(workers, teamName);
  if (teamWorkers.length === 0) {
    return (
      <div className="pt-3 border-t border-border">
        <p className="text-muted-foreground text-xs">该团队暂无 Worker</p>
      </div>
    );
  }
  return (
    <div className="pt-3 border-t border-border">
      <p className="text-muted-foreground mb-2">团队中的 Workers</p>
      <div className="space-y-2">
        {teamWorkers.map((w) => (
          <div key={w.name} className="flex items-center gap-2 p-2 rounded-lg bg-background/50">
            <StatusDot phase={w.phase} />
            <Bot className="w-4 h-4 text-orange-500" aria-hidden="true" />
            <span className="text-xs font-medium">{w.name}</span>
            <PhaseBadge kind="worker" phase={w.phase} className="text-[10px] ml-auto" />
          </div>
        ))}
      </div>
    </div>
  );
}

export function TeamDetailDialog({
  team,
  workers,
  onOpenChange,
}: {
  team: TeamResponse | null;
  workers: WorkerResponse[];
  onOpenChange: (_open: boolean) => void;
}) {
  return (
    <Dialog open={!!team} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>团队详情 - {team?.name}</DialogTitle>
        </DialogHeader>
        {team && (
          <div className="space-y-3 py-4 text-sm">
            <div className="flex items-center gap-2 mb-3">
              <StatusDot phase={team.phase} />
              <Users className="w-5 h-5 text-emerald-500" aria-hidden="true" />
              <PhaseBadge kind="team" phase={team.phase} />
            </div>
            <TeamHealthPanel team={team} allWorkers={workers} />
            {DETAIL_FIELDS.map(([label, read]) => (
              <div
                key={label}
                className="flex justify-between py-1 border-b border-border/50"
              >
                <span className="text-muted-foreground">{label}</span>
                <span className="font-mono text-xs max-w-[60%] text-right break-all">
                  {read(team)}
                </span>
              </div>
            ))}
            {team.leaderHeartbeat && (
              <div className="pt-2">
                <p className="text-muted-foreground mb-1">Leader 心跳</p>
                <p className="text-xs font-mono">
                  启用: {team.leaderHeartbeat.enabled ? '是' : '否'} / 间隔: {team.leaderHeartbeat.every}
                </p>
              </div>
            )}
            <TeamWorkersList teamName={team.name} workers={workers} />
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
