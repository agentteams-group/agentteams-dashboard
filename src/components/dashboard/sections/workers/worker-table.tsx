'use client';

import { Bot, CheckSquare, Eye, MessageSquare, Square } from 'lucide-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ResourceListMenu } from '@/components/dashboard/resource-list-menu';
import { StatusDot } from '@/components/dashboard/status-dot';
import { WorkerSessionName } from './worker-session-name';
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
import { isLegacyCopaw } from '@/lib/runtime-options';

export function WorkerTable({
  workers,
  selectedWorkers,
  onToggleSelect,
  onView,
  onEdit,
  onOpenChat,
  onWake,
  onSleep,
  onEnsureReady,
  onUpgradeToQwenPaw,
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
  onOpenChat?: (_worker: WorkerResponse) => void;
  onWake: (_name: string) => void;
  onSleep: (_name: string) => void;
  onEnsureReady: (_name: string) => void;
  onUpgradeToQwenPaw?: (_worker: WorkerResponse) => void;
  onDelete: (_name: string) => void;
  isActionPending: boolean;
  deletingWorkerNames: Set<string>;
  /** Compact mode omits the team column. */
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
            <TableHead>运行时</TableHead>
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
                className={selectedWorkers.has(worker.name) ? 'bg-accent' : ''}
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
                  <WorkerSessionName worker={worker} className="max-w-[180px]" />
                </div>
              </TableCell>
              <TableCell>
                <PhaseBadge kind="worker" phase={worker.phase} />
                {isDeleting && <span role="status" className="ml-2 text-xs text-amber-600">删除中</span>}
              </TableCell>
              <TableCell>
                <RuntimeBadge runtime={worker.runtime} withTooltip />
              </TableCell>
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
                    onClick={() => onOpenChat?.(worker)}
                    title="打开聊天"
                    aria-label={`打开 ${worker.name} 聊天`}
                    disabled={isDeleting || !worker.roomID || !onOpenChat}
                  >
                    <MessageSquare className="w-3.5 h-3.5" aria-hidden="true" />
                  </Button>
                  <ResourceListMenu label={`${worker.name} 更多操作`} disabled={isDeleting} items={[
                    { label: '编辑', onSelect: () => onEdit(worker) },
                    ...(worker.state === 'Sleeping' ? [{ label: '唤醒', onSelect: () => onWake(worker.name), disabled: isActionPending }] : []),
                    ...(worker.state === 'Running' ? [{ label: '休眠', onSelect: () => onSleep(worker.name), disabled: isActionPending }] : []),
                    ...(['Pending', 'Stopped'].includes(worker.phase) ? [{ label: 'Ensure Ready', onSelect: () => onEnsureReady(worker.name), disabled: isActionPending }] : []),
                    ...(isLegacyCopaw(worker.runtime) && onUpgradeToQwenPaw ? [{ label: '升级到 QwenPaw', onSelect: () => onUpgradeToQwenPaw(worker), disabled: isActionPending }] : []),
                    { label: '删除', onSelect: () => onDelete(worker.name), disabled: isActionPending, destructive: true },
                  ]} />
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
