'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { CheckSquare, Eye, Square } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { ResourceListMenu } from '@/components/dashboard/resource-list-menu';
import { StatusDot } from '@/components/dashboard/status-dot';
import { WorkerSessionName } from './worker-session-name';
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import type { WorkerResponse } from '@/lib/agentteams-api';

function canSleep(worker: WorkerResponse): boolean {
  return worker.phase === 'Running' || worker.phase === 'Ready';
}

function canWake(worker: WorkerResponse): boolean {
  return worker.phase === 'Sleeping' || worker.phase === 'Stopped';
}

export function WorkerCard({
  worker,
  index,
  isSelected,
  onToggleSelect,
  onView,
  onOpenDrawer,
  onRestart,
  onWake,
  onSleep,
  isActionPending,
  isRestarting = false,
  isDeleting,
}: {
  worker: WorkerResponse;
  index: number;
  isSelected: boolean;
  onToggleSelect: () => void;
  /** 只读详情弹窗。 */
  onView: () => void;
  /** 点击卡片其它区域 → 右侧详情抽屉。 */
  onOpenDrawer: () => void;
  onRestart: () => void;
  onWake: () => void;
  onSleep: () => void;
  isActionPending: boolean;
  isRestarting?: boolean;
  isDeleting: boolean;
}) {
  const reduceMotion = useReducedMotion();

  const sleeping = canWake(worker);

  return (
    <motion.div
      initial={reduceMotion ? false : { opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={reduceMotion ? { duration: 0 } : { delay: index * 0.03 }}
      layout
      className="h-full"
    >
      <Card
        aria-busy={isDeleting || undefined}
        data-testid="worker-card"
        role="group"
        tabIndex={0}
        aria-label={`打开 ${worker.name} 详情面板`}
        onClick={() => {
          if (!isDeleting) onOpenDrawer();
        }}
        onKeyDown={(event) => {
          if (event.target !== event.currentTarget) return;
          if (event.key !== 'Enter' && event.key !== ' ') return;
          event.preventDefault();
          if (!isDeleting) onOpenDrawer();
        }}
        className={`relative h-full flex flex-col glass-card cursor-pointer transition-shadow hover:ring-2 hover:ring-ring/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
          isSelected ? 'ring-2 ring-ring/50' : ''
        } ${isDeleting ? 'worker-card-deleting' : ''}`}
      >
        {isDeleting && (
          <div className="absolute inset-0 z-10 rounded-[inherit] bg-background/40" data-testid="deleting-overlay">
            <div
              role="status"
              className="absolute inset-x-3 top-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1.5"
            >
              <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
                删除中，等待 Controller 完成任务
              </p>
              <div className="mt-1 h-1 overflow-hidden rounded-full bg-amber-500/20">
                <div className="deleting-progress-indicator h-full w-2/5 rounded-full bg-amber-500" />
              </div>
            </div>
          </div>
        )}
        <CardContent className={`p-4 ${isDeleting ? 'pointer-events-none' : ''}`}>
          <div className="flex items-start justify-between gap-2 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleSelect();
                }}
                className="shrink-0"
                title={isSelected ? '取消选择' : '选择'}
                aria-label={isSelected ? '取消选择' : '选择'}
                aria-pressed={isSelected}
                disabled={isDeleting}
              >
                {isSelected ? (
                  <CheckSquare className="w-4 h-4 text-emerald-500" aria-hidden="true" />
                ) : (
                  <Square
                    className="w-4 h-4 text-muted-foreground/50 hover:text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
              </button>
              <StatusDot phase={worker.phase} />
              <WorkerSessionName worker={worker} />
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <PhaseBadge kind="worker" phase={worker.phase} />
            </div>
          </div>

          <div className="mb-3 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
            <RuntimeBadge runtime={worker.runtime} />
            <span className="shrink-0">团队</span>
            <span className="truncate" title={worker.team}>{worker.team || '未分组'}</span>
          </div>
          {worker.lastTaskSummary && (
            <p className="mb-3 truncate text-xs" title={worker.lastTaskSummary}>{worker.lastTaskSummary}</p>
          )}
          {worker.message && (
            <p className="mb-3 text-xs text-amber-600 dark:text-amber-400">有运行提示，查看详情</p>
          )}

          <div className="flex items-center gap-1.5 mt-auto pt-3 border-t border-border">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs flex-1"
              onClick={(event) => {
                event.stopPropagation();
                onView();
              }}
            >
              <Eye className="w-3 h-3 mr-1" aria-hidden="true" />
              详情
            </Button>
            <ResourceListMenu label={`${worker.name} 更多操作`} disabled={isDeleting} items={[
              { label: '重启', onSelect: onRestart, disabled: isActionPending || isRestarting },
              { label: sleeping ? '唤醒' : '休眠', onSelect: sleeping ? onWake : onSleep,
                disabled: isActionPending || (!sleeping && !canSleep(worker)) },
            ]} />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
