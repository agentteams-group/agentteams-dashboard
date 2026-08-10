'use client';

import { useMemo } from 'react';
import { useShallow } from 'zustand/shallow';
import { Crown, ListTodo, Loader2, CircleCheck, CircleX } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { CopyButton } from '@/components/dashboard/copy-button';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RUNTIME_LABELS, WORKER_PHASE_BADGE_CLASSES } from '@/lib/phase-colors';
import type { ManagerResponse, TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import { getManagedTeams, getManagedWorkers, getManagerSkills } from './manager-selectors';
import { useTaskStore, selectTaskList } from '@/lib/task-store';
import { actorFromManager, actorAsLeader } from '@/lib/task-actors';

const DETAIL_FIELDS: Array<[string, (_m: ManagerResponse) => string]> = [
  ['名称', (m) => m.name],
  ['状态', (m) => m.state],
  ['模型', (m) => m.model || '-'],
  ['运行时', (m) => RUNTIME_LABELS[m.runtime] || m.runtime || '-'],
  ['镜像', (m) => m.image || '-'],
  ['版本', (m) => m.version || '-'],
  ['欢迎消息', (m) => (m.welcomeSent ? '已发送' : '未发送')],
  ['消息', (m) => m.message || '-'],
];

function DetailRow({ label, value, copy }: { label: string; value: string; copy?: string }) {
  return (
    <div className="flex justify-between py-1 border-b border-border/50">
      <span className="text-muted-foreground">{label}</span>
      {copy ? (
        <div className="flex items-center gap-1 min-w-0 max-w-[60%]">
          <span className="font-mono text-xs truncate">{value}</span>
          <CopyButton text={copy} />
        </div>
      ) : (
        <span className="font-mono text-xs max-w-[60%] text-right break-all">{value}</span>
      )}
    </div>
  );
}

function renderTaskRow(
  task: { runId: string; title: string; status: string; updatedAt: number },
  perspective: 'global' | 'leader',
) {
  const running = task.status === 'in_progress' || task.status === 'running';
  const complete = task.status === 'completed' || task.status === 'success' || task.status === 'done';
  const failed = task.status === 'failed' || task.status === 'error' || task.status === 'cancelled';
  const Accent = perspective === 'global' ? Crown : ListTodo;
  return (
    <div
      key={task.runId}
      className="flex items-center gap-2 px-2 py-1.5 rounded bg-muted/30 text-xs"
    >
      {complete ? (
        <CircleCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
      ) : failed ? (
        <CircleX className="h-3.5 w-3.5 text-red-500 shrink-0" />
      ) : (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-violet-500 shrink-0" />
      )}
      <Accent className="h-3 w-3 text-violet-500 shrink-0" />
      <span className="flex-1 truncate">{task.title}</span>
      <span className="font-mono text-[10px] text-muted-foreground">
        {task.runId.slice(0, 8)}
      </span>
      <span className="text-muted-foreground text-[10px]">
        {new Date(task.updatedAt).toLocaleTimeString()}
      </span>
      {running && <Badge variant="outline" className="text-[9px] px-1 py-0">进行中</Badge>}
    </div>
  );
}

export function ManagerDetailDialog({
  manager,
  workers,
  teams,
  onOpenChange,
}: {
  manager: ManagerResponse | null;
  workers: WorkerResponse[];
  teams: TeamResponse[];
  onOpenChange: (_open: boolean) => void;
}) {
  const skills = manager ? getManagerSkills(manager) : [];
  const managedTeams = manager ? getManagedTeams(teams, manager.name) : [];
  const managedWorkers = manager ? getManagedWorkers(workers, teams, manager.name) : [];

  // Live in-flight tasks for this Manager, sliced into two perspectives:
  //  - globalTasks: workflow messages where the Manager is the sender (its
  //    own dispatched tasks, regardless of which room they ended up in)
  //  - leaderTasks: workflow messages that originated in any Team room the
  //    Manager leads (covers Worker-reported sub-flows inside the team)
  const tasks = useTaskStore(useShallow((s) => selectTaskList(s.tasks)));
  const { globalTasks, leaderTasks } = useMemo(() => {
    if (!manager) return { globalTasks: [], leaderTasks: [] };
    const global = actorFromManager(manager);
    const leader = actorAsLeader(manager, teams);
    return {
      globalTasks: tasks
        .filter(
          (t) =>
            t.senderMatrixUserId === global.matrixUserId || global.roomIds.has(t.roomId),
        )
        .slice(0, 8),
      leaderTasks: tasks
        .filter((t) => leader.roomIds.has(t.roomId) && !(global.roomIds.has(t.roomId) && t.senderMatrixUserId === global.matrixUserId))
        .slice(0, 8),
    };
  }, [manager, tasks, teams]);

  const countByStatus = (arr: typeof tasks) => ({
    running: arr.filter((t) => t.status === 'in_progress' || t.status === 'running').length,
    completed: arr.filter((t) => t.status === 'completed' || t.status === 'success' || t.status === 'done').length,
    failed: arr.filter((t) => t.status === 'failed' || t.status === 'error' || t.status === 'cancelled').length,
  });
  const globalCounts = countByStatus(globalTasks);
  const leaderCounts = countByStatus(leaderTasks);

  return (
    <Dialog open={!!manager} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-w-[95vw] max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Manager 详情 - {manager?.name}</DialogTitle>
        </DialogHeader>
        {manager && (
          <div className="space-y-3 py-4 text-sm">
            <div className="flex items-center gap-2 mb-3">
              <StatusDot phase={manager.phase} />
              <PhaseBadge kind="manager" phase={manager.phase} />
              <RuntimeBadge runtime={manager.runtime || ''} />
            </div>
            {DETAIL_FIELDS.map(([label, read]) => (
              <DetailRow key={label} label={label} value={read(manager)} />
            ))}
            <DetailRow
              label="Matrix 用户"
              value={manager.matrixUserID || '-'}
              copy={manager.matrixUserID || undefined}
            />
            <DetailRow
              label="房间 ID"
              value={manager.roomID || '-'}
              copy={manager.roomID || undefined}
            />
            <div className="pt-2">
              <p className="text-muted-foreground mb-2">技能</p>
              <div className="flex flex-wrap gap-1">
                {skills.map((skill) => (
                  <Badge key={skill} variant="outline" className="text-[10px]">
                    {skill}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="pt-2">
              <p className="text-muted-foreground mb-2">协调的团队</p>
              <div className="flex flex-wrap gap-1">
                {managedTeams.length > 0 ? (
                  managedTeams.map((t) => (
                    <Badge key={t.name} variant="secondary" className="text-xs gap-1">
                      {t.name}
                      <Badge variant="outline" className="text-[8px] px-1 py-0 h-3.5">
                        {t.readyWorkers}/{t.totalWorkers}
                      </Badge>
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">-</span>
                )}
              </div>
            </div>
            <div className="pt-2">
              <p className="text-muted-foreground mb-2">协调的 Workers</p>
              <div className="flex flex-wrap gap-1">
                {managedWorkers.length > 0 ? (
                  managedWorkers.map((w) => (
                    <Badge
                      key={w.name}
                      variant="secondary"
                      className={`text-xs ${WORKER_PHASE_BADGE_CLASSES[w.phase] || ''}`}
                    >
                      {w.name}
                    </Badge>
                  ))
                ) : (
                  <span className="text-xs text-muted-foreground">-</span>
                )}
              </div>
            </div>
            <div className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <p className="text-muted-foreground flex items-center gap-1.5">
                  <Crown className="h-3.5 w-3.5" />
                  Manager 全局任务
                </p>
                <div className="flex items-center gap-2 text-[10px]">
                  {globalCounts.running > 0 && (
                    <span className="flex items-center gap-0.5 text-violet-600 dark:text-violet-400">
                      <Loader2 className="h-3 w-3" />
                      {globalCounts.running}
                    </span>
                  )}
                  {globalCounts.completed > 0 && (
                    <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                      <CircleCheck className="h-3 w-3" />
                      {globalCounts.completed}
                    </span>
                  )}
                  {globalCounts.failed > 0 && (
                    <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
                      <CircleX className="h-3 w-3" />
                      {globalCounts.failed}
                    </span>
                  )}
                </div>
              </div>
              {globalTasks.length === 0 ? (
                <p className="text-xs text-muted-foreground">该 Manager 暂无 sender 任务</p>
              ) : (
                <div className="space-y-1.5">
                  {globalTasks.map((task) => renderTaskRow(task, 'global'))}
                </div>
              )}
            </div>
            <div className="pt-2">
              <div className="flex items-center justify-between mb-2">
                <p className="text-muted-foreground flex items-center gap-1.5">
                  <ListTodo className="h-3.5 w-3.5" />
                  Leader 团队任务
                  <span className="text-[10px] text-muted-foreground/70">
                    ({managedTeams.length} 个团队)
                  </span>
                </p>
                <div className="flex items-center gap-2 text-[10px]">
                  {leaderCounts.running > 0 && (
                    <span className="flex items-center gap-0.5 text-violet-600 dark:text-violet-400">
                      <Loader2 className="h-3 w-3" />
                      {leaderCounts.running}
                    </span>
                  )}
                  {leaderCounts.completed > 0 && (
                    <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                      <CircleCheck className="h-3 w-3" />
                      {leaderCounts.completed}
                    </span>
                  )}
                  {leaderCounts.failed > 0 && (
                    <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
                      <CircleX className="h-3 w-3" />
                      {leaderCounts.failed}
                    </span>
                  )}
                </div>
              </div>
              {leaderTasks.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  {managedTeams.length > 0
                    ? '这些团队房间内暂无 workflow 任务'
                    : '该 Manager 当前不是任何 Team 的 leader'}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {leaderTasks.map((task) => renderTaskRow(task, 'leader'))}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
