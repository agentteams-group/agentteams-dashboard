'use client';

import { useMemo } from 'react';
import { ShieldAlert, PauseCircle, MessageSquare, GitBranch } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useProjects } from '@/hooks/use-projects';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useSectionStore } from '@/lib/section-store';
import {
  selectConfirmationList,
  useHitlInboxStore,
  type HitlConfirmation,
  type PendingProjectKey,
} from '@/lib/hitl-inbox';
import type { ProjectSummary } from '@/lib/agentteams-projects-api';

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  if (diff < 60000) return `${Math.max(1, Math.floor(diff / 1000))}秒前`;
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  return `${Math.floor(diff / 86400000)}天前`;
}

function openChatRoom(roomId: string) {
  useHitlInboxStore.getState().setPendingChatRoomId(roomId);
  useSectionStore.getState().setActiveSection('chat');
}

function openProject(key: PendingProjectKey) {
  useHitlInboxStore.getState().setPendingProjectKey(key);
  useSectionStore.getState().setActiveSection('projects');
}

export function HitlInboxCard() {
  const confirmationsMap = useHitlInboxStore((s) => s.confirmations);
  const confirmations = useMemo(
    () => selectConfirmationList(confirmationsMap),
    [confirmationsMap],
  );
  const { data: projectList } = useProjects();
  const { data: workers } = useWorkers();
  const { data: teams } = useTeams();
  const { data: managers } = useManagers();

  const pausedProjects = useMemo(
    () => (projectList?.projects ?? []).filter((p) => p.status === 'paused'),
    [projectList],
  );

  const roomLabels = useMemo(() => {
    const labels: Record<string, string> = {};
    for (const worker of workers ?? []) {
      if (worker.roomID) labels[worker.roomID] = worker.name;
    }
    for (const team of teams ?? []) {
      if (team.teamRoomID) labels[team.teamRoomID] = team.teamName || team.name;
    }
    for (const manager of managers ?? []) {
      if (manager.roomID) labels[manager.roomID] = manager.name;
    }
    return labels;
  }, [workers, teams, managers]);

  if (confirmations.length === 0 && pausedProjects.length === 0) return null;

  return (
    <Card className="glass-card border-amber-500/20">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-semibold flex items-center gap-2">
          <ShieldAlert className="w-4 h-4 text-amber-500" />
          待决策
          <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-amber-500/30 text-amber-600 dark:text-amber-400">
            {confirmations.length + pausedProjects.length}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0 space-y-1.5">
        {confirmations.map((item) => (
          <ConfirmationRow
            key={item.id}
            item={item}
            roomLabel={roomLabels[item.roomId] ?? item.roomId}
          />
        ))}
        {pausedProjects.map((project) => (
          <PausedProjectRow key={`${project.team_id ?? ''}:${project.project_id}`} project={project} />
        ))}
      </CardContent>
    </Card>
  );
}

function ConfirmationRow({ item, roomLabel }: { item: HitlConfirmation; roomLabel: string }) {
  return (
    <button
      type="button"
      onClick={() => openChatRoom(item.roomId)}
      className="w-full text-left rounded-lg border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 px-3 py-2 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate">工具审批 · {item.toolName}</span>
        <span className="text-[10px] text-muted-foreground whitespace-nowrap">{formatRelativeTime(item.timestamp)}</span>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <MessageSquare className="w-3 h-3 shrink-0" />
        <span className="truncate">{roomLabel}</span>
        {item.triggeredBy && <span className="truncate">· {item.triggeredBy}</span>}
      </div>
    </button>
  );
}

function PausedProjectRow({ project }: { project: ProjectSummary }) {
  return (
    <button
      type="button"
      onClick={() => openProject({ id: project.project_id, team: project.team_id })}
      className="w-full text-left rounded-lg border border-violet-500/20 bg-violet-500/5 hover:bg-violet-500/10 px-3 py-2 transition-colors"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium truncate flex items-center gap-1.5">
          <PauseCircle className="w-3.5 h-3.5 text-violet-500 shrink-0" />
          {project.title}
        </span>
        <Badge variant="outline" className="text-[10px] h-4 px-1.5 border-violet-500/30 text-violet-600 dark:text-violet-400">
          已暂停
        </Badge>
      </div>
      <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <GitBranch className="w-3 h-3 shrink-0" />
        <span className="truncate font-mono">{project.project_id}</span>
        {project.team_id && <span className="truncate">· {project.team_id}</span>}
      </div>
    </button>
  );
}
