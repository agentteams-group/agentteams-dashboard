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
import { actorFromManager } from '@/lib/task-actors';

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

  // Live in-flight tasks for this Manager (from Matrix workflow messages).
  // Filter by both senderMatrixUserId and room membership to catch workflow
  // messages that came from this Manager into any room it owns.
  const tasks = useTaskStore(useShallow((s) => selectTaskList(s.tasks)));
  const managerTasks = useMemo(() => {
    if (!manager) return [];
    const lookup = actorFromManager(manager);
    return tasks
      .filter(
        (t) => t.senderMatrixUserId === lookup.matrixUserId || lookup.roomIds.has(t.roomId),
      )
      .slice(0, 8);
  }, [manager, tasks]);
  const runningCount = managerTasks.filter((t) => t.status === 'in_progress' || t.status === 'running').length;
  const completedCount = managerTasks.filter((t) => t.status === 'completed' || t.status === 'success' || t.status === 'done').length;
  const failedCount = managerTasks.filter((t) => t.status === 'failed' || t.status === 'error' || t.status === 'cancelled').length;

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
                  <ListTodo className="h-3.5 w-3.5" />
                  进行中任务
                </p>
                <div className="flex items-center gap-2 text-[10px]">
                  {runningCount > 0 && (
                    <span className="flex items-center gap-0.5 text-violet-600 dark:text-violet-400">
                      <Loader2 className="h-3 w-3" />
                      {runningCount}
                    </span>
                  )}
                  {completedCount > 0 && (
                    <span className="flex items-center gap-0.5 text-emerald-600 dark:text-emerald-400">
                      <CircleCheck className="h-3 w-3" />
                      {completedCount}
                    </span>
                  )}
                  {failedCount > 0 && (
                    <span className="flex items-center gap-0.5 text-red-600 dark:text-red-400">
                      <CircleX className="h-3 w-3" />
                      {failedCount}
                    </span>
                  )}
                </div>
              </div>
              {managerTasks.length === 0 ? (
                <p className="text-xs text-muted-foreground">该 Manager 暂无 Matrix workflow 任务记录</p>
              ) : (
                <div className="space-y-1.5">
                  {managerTasks.map((task) => {
                    const running = task.status === 'in_progress' || task.status === 'running';
                    const complete = task.status === 'completed' || task.status === 'success' || task.status === 'done';
                    const failed = task.status === 'failed' || task.status === 'error' || task.status === 'cancelled';
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
                        <Crown className="h-3 w-3 text-violet-500 shrink-0" />
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
                  })}
                </div>
              )}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
