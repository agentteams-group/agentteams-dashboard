'use client';

import { Bot, CheckSquare, Eye, Moon, Pencil, Rocket, Square, Sun, Trash2 } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import type { WorkerResponse } from '@/lib/agentteams-api';

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
}) {
  return (
    <Card className="glass-card overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-10"></TableHead>
            <TableHead>名称</TableHead>
            <TableHead>阶段</TableHead>
            <TableHead>状态</TableHead>
            <TableHead>运行时</TableHead>
            <TableHead>模型</TableHead>
            <TableHead>团队</TableHead>
            <TableHead className="text-right">操作</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {workers.map((worker) => (
            <TableRow
              key={worker.name}
              className={selectedWorkers.has(worker.name) ? 'bg-primary/5' : ''}
            >
              <TableCell>
                <button
                  onClick={() => onToggleSelect(worker.name)}
                  title={selectedWorkers.has(worker.name) ? '取消选择' : '选择'}
                  aria-label={selectedWorkers.has(worker.name) ? '取消选择' : '选择'}
                  aria-pressed={selectedWorkers.has(worker.name)}
                >
                  {selectedWorkers.has(worker.name) ? (
                    <CheckSquare className="w-4 h-4 text-primary" aria-hidden="true" />
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
                  <Bot className="w-4 h-4 text-primary shrink-0" aria-hidden="true" />
                  <span className="font-medium truncate max-w-[180px]">{worker.name}</span>
                </div>
              </TableCell>
              <TableCell>
                <PhaseBadge kind="worker" phase={worker.phase} />
              </TableCell>
              <TableCell>
                <span className="text-xs text-muted-foreground">{worker.state}</span>
              </TableCell>
              <TableCell>
                <RuntimeBadge runtime={worker.runtime} />
              </TableCell>
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
              <TableCell>
                <span className="text-xs truncate max-w-[100px] block">{worker.team || '-'}</span>
              </TableCell>
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
                      disabled={isActionPending}
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
                      disabled={isActionPending}
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
                      disabled={isActionPending}
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
                    disabled={isActionPending}
                  >
                    <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                </div>
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </Card>
  );
}
