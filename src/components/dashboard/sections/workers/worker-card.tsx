'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { Bot, CheckSquare, Eye, Moon, RefreshCw, Square, Sun } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusDot } from '@/components/dashboard/status-dot';
import { WorkerSessionName } from './worker-session-name';
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import { HealthRingCompact } from '@/components/dashboard/health-ring';
import { useAgentHealth } from '@/hooks/use-agent-health';
import { useNowTick } from '@/hooks/use-now-tick';
import { getRuntimeMeta } from '@/lib/runtime-meta';
import { RUNTIME_LABELS } from '@/lib/phase-colors';
import { countToolCalls24h } from '@/lib/tool-call-counter';
import {
  buildStatusNarrative,
  formatAgoZh,
  formatDurationZh,
  healthTierLabel,
  NO_DATA,
  truncateCell,
} from '@/lib/worker-activity';
import type { WorkerResponse } from '@/lib/agentteams-api';

function VitalCell({ label, value, fullValue }: { label: string; value: string; fullValue?: string }) {
  return (
    <div className="min-w-0" title={fullValue && fullValue !== value ? fullValue : undefined}>
      <p className="text-xs leading-4 text-muted-foreground">{label}</p>
      <p className="truncate text-xs leading-5">{value}</p>
    </div>
  );
}

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
  const health = useAgentHealth(worker);
  const now = useNowTick(30_000);
  const reduceMotion = useReducedMotion();

  const runtimeMeta = getRuntimeMeta(worker.runtime);
  const RuntimeIcon = runtimeMeta?.icon ?? Bot;
  const narrative = buildStatusNarrative(worker, now);

  const taskText = worker.lastTaskSummary || worker.message || '';
  const durationText = worker.stateStartedAt ? formatDurationZh(worker.stateStartedAt, now) : null;
  const activityText = worker.lastActivityAt ? formatAgoZh(worker.lastActivityAt, now) : null;
  const toolCallCount = countToolCalls24h(worker.name, now);

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
          <div className="flex items-start justify-between mb-3">
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
              <RuntimeBadge runtime={worker.runtime} withTooltip />
              {health && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div aria-label={`${healthTierLabel(health.overall, worker.phase)}，${health.overall} 分`}>
                      <HealthRingCompact score={health.overall} size={24} />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs font-medium">
                      {healthTierLabel(health.overall, worker.phase)}（{health.overall} 分）
                    </p>
                    <p className="text-xs text-muted-foreground">可用性 {health.availability} · 稳定性 {health.stability} · 就绪度 {health.readiness}</p>
                  </TooltipContent>
                </Tooltip>
              )}
              <PhaseBadge kind="worker" phase={worker.phase} />
            </div>
          </div>

          {/* Vitals strip: 最近任务 / 持续时长 / 最近活动 / 工具调用 */}
          <div className="grid grid-cols-4 gap-2 rounded-md bg-muted/40 px-2 py-1.5 mb-2" data-testid="vitals-strip">
            <VitalCell label="最近任务" value={taskText ? truncateCell(taskText) : NO_DATA} fullValue={taskText || undefined} />
            <VitalCell label="持续时长" value={durationText ?? NO_DATA} />
            <VitalCell label="最近活动" value={activityText ?? NO_DATA} />
            <VitalCell label="工具调用" value={toolCallCount > 0 ? `${toolCallCount} 次` : NO_DATA} />
          </div>

          {/* Status narrative: what it is doing, in ops language */}
          <p className="mb-2 truncate text-xs text-foreground/80" title={narrative} data-testid="status-narrative">
            {narrative}
          </p>

          {/* Runtime capability strip */}
          <div className="mb-3 flex items-center gap-1.5 text-xs text-muted-foreground" data-testid="runtime-feature">
            <RuntimeIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="shrink-0 font-medium">{RUNTIME_LABELS[worker.runtime] || worker.runtime}</span>
            <span className="truncate" title={runtimeMeta?.description}>
              {runtimeMeta?.description ?? '未登记的运行时'}
            </span>
          </div>

          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">模型</span>
              <Tooltip>
                <TooltipTrigger asChild>
                  <span className="font-mono text-xs truncate ml-2 cursor-help">
                    {worker.model || '-'}
                  </span>
                </TooltipTrigger>
                <TooltipContent>完整模型名: {worker.model || '未设置'}</TooltipContent>
              </Tooltip>
            </div>
            {worker.team && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">团队</span>
                <span className="text-xs truncate ml-2">{worker.team}</span>
              </div>
            )}
          </div>

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
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs flex-1"
              onClick={(event) => {
                event.stopPropagation();
                onRestart();
              }}
              disabled={isActionPending || isRestarting || isDeleting}
            >
              <RefreshCw className={`w-3 h-3 mr-1 ${isRestarting ? 'animate-spin' : ''}`} aria-hidden="true" />
              重启
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs flex-1"
              onClick={(event) => {
                event.stopPropagation();
                if (sleeping) onWake();
                else onSleep();
              }}
              disabled={isActionPending || isDeleting || (!sleeping && !canSleep(worker))}
            >
              {sleeping ? (
                <Sun className="w-3 h-3 mr-1" aria-hidden="true" />
              ) : (
                <Moon className="w-3 h-3 mr-1" aria-hidden="true" />
              )}
              {sleeping ? '唤醒' : '休眠'}
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
