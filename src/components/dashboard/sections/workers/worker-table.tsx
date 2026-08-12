'use client';

import { Bot, CheckSquare, Eye, Moon, Pencil, Rocket, Square, Sun, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import { HealthRingCompact } from '@/components/dashboard/health-ring';
import { useAgentHealth } from '@/hooks/use-agent-health';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { WorkerResponse } from '@/lib/agentteams-api';

/** Health cell for compact mode (hooks must run inside a component per row). */
function CompactHealthCell({ worker }: { worker: WorkerResponse }) {
  const health = useAgentHealth(worker);
  if (!health) return <span className="text-xs text-muted-foreground">-</span>;
  return <HealthRingCompact score={health.overall} size={22} />;
}

export function WorkerTable({
  workers,
  selectedWorkers,
  onToggleSelect,
  onView,
  onEdit,
  onWake,
  onSleep,
  onEnsureReady,
  onDelete,
  isActionPending,
  deletingWorkerNames,
  compact = false,
}: {
  workers: WorkerResponse[];
  selectedWorkers: Set<string>;
  onToggleSelect: (_name: string) => void;
  onView: (_worker: WorkerResponse) => void;
  onEdit: (_worker: WorkerResponse) => void;
  onWake: (_name: string) => void;
  onSleep: (_name: string) => void;
  onEnsureReady: (_name: string) => void;
  onDelete: (_name: string) => void;
  isActionPending: boolean;
  deletingWorkerNames: Set<string>;
  /** Compact mode keeps only select/name/phase/runtime/health/actions. */
  compact?: boolean;
}) {
  return (
    <Card className="glass-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"></TableHead>
            <TableHead>名称</TableHead>
            <TableHead>阶段</TableHead>
            {!compact && <TableHead>状态</TableHead>}
            {!compact && <TableHead>任务</TableHead>}
            <TableHead>运行时</TableHead>
            {compact && <TableHead>健康</TableHead>}
            {!compact && <TableHead>模型</TableHead>}
            {!compact && <TableHead>团队</TableHead>}
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workers.map((worker) => {
            const isDeleting = deletingWorkerNames.has(worker.name);
            return (
              <TableRow
                key={worker.name}
                className={selectedWorkers.has(worker.name) ? 'bg-emerald-500/5' : ''}
              >
              <TableCell>
                <button
                  onClick={() => onToggleSelect(worker.name)}
                  title={selectedWorkers.has(worker.name) ? '取消选择' : '选择'}
                  aria-label={selectedWorkers.has(worker.name) ? '取消选择' : '选择'}
                  aria-pressed={selectedWorkers.has(worker.name)}
                  disabled={isDeleting}
                >
                  {selectedWorkers.has(worker.name) ? (
                    <CheckSquare className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                  ) : (
                    <Square
                      className="w-4 h-4 text-muted-foreground/50 hover:text-muted-foreground"
                      aria-hidden="true"
                    />
                  )}
                </button>
              </TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <StatusDot phase={worker.phase} />
                  <Bot className="w-4 h-4 text-emerald-500 shrink-0" aria-hidden="true" />
                  <span className="font-medium truncate max-w-[180px]">{worker.name}</span>
                </div>
              </TableCell>
              <TableCell>
                <PhaseBadge kind="worker" phase={worker.phase} />
              </TableCell>
              {!compact && (
                <TableCell>
                  <span className="text-xs text-muted-foreground">{worker.state}</span>
                </TableCell>
              )}
              {!compact && (
                <TableCell>
                  {isDeleting ? (
                    <span role="status" className="text-xs font-medium text-amber-600 dark:text-amber-400">
                      删除中
                    </span>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
              )}
              <TableCell>
                <RuntimeBadge runtime={worker.runtime} withTooltip />
              </TableCell>
              {compact && (
                <TableCell>
                  {isDeleting ? (
                    <span role="status" className="text-xs font-medium text-amber-600 dark:text-amber-400">
                      删除中
                    </span>
                  ) : (
                    <CompactHealthCell worker={worker} />
                  )}
                </TableCell>
              )}
              {!compact && (
                <TableCell>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <span className="font-mono text-xs truncate max-w-[150px] block cursor-help">
                        {worker.model || '-'}
                      </span>
                    </TooltipTrigger>
                    <TooltipContent>完整模型名: {worker.model || '未设置'}</TooltipContent>
                  </Tooltip>
                </TableCell>
              )}
              {!compact && (
                <TableCell>
                  <span className="text-xs truncate max-w-[100px] block">{worker.team || '-'}</span>
                </TableCell>
              )}
              <TableCell>
                <div className="flex items-center justify-end gap-1">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => onView(worker)}
                    title="查看详情"
                    aria-label={`查看 ${worker.name} 详情`}
                  >
                    <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0"
                    onClick={() => onEdit(worker)}
                    title="编辑"
                    aria-label={`编辑 ${worker.name}`}
                    disabled={isDeleting}
                  >
                    <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  {worker.state === 'Sleeping' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => onWake(worker.name)}
                      title="唤醒"
                      aria-label={`唤醒 ${worker.name}`}
                      disabled={isActionPending || isDeleting}
                    >
                      <Sun className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  )}
                  {worker.state === 'Running' && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => onSleep(worker.name)}
                      title="休眠"
                      aria-label={`休眠 ${worker.name}`}
                      disabled={isActionPending || isDeleting}
                    >
                      <Moon className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  )}
                  {(worker.phase === 'Pending' || worker.phase === 'Stopped') && (
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-7 p-0"
                      onClick={() => onEnsureReady(worker.name)}
                      title="Ensure Ready"
                      aria-label={`Ensure Ready ${worker.name}`}
                      disabled={isActionPending || isDeleting}
                    >
                      <Rocket className="w-3.5 h-3.5" aria-hidden="true" />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 text-destructive hover:text-destructive"
                    onClick={() => onDelete(worker.name)}
                    title="删除"
                    aria-label={`删除 ${worker.name}`}
                    disabled={isActionPending || isDeleting}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Card>
  );
}
