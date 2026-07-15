'use client';

import { motion } from 'framer-motion';
import { Bot, CheckSquare, Eye, Moon, Pencil, Square, Sun } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { StatusDot } from '@/components/dashboard/status-dot';
import { PhaseBadge, RuntimeBadge } from '@/components/dashboard/phase-badge';
import { HealthRingCompact } from '@/components/dashboard/health-ring';
import { useAgentHealth } from '@/hooks/use-agent-health';
import type { WorkerResponse } from '@/lib/agentteams-api';

export function WorkerCard({
  worker,
  index,
  isSelected,
  onToggleSelect,
  onView,
  onEdit,
  onWake,
  onSleep,
  onDelete,
  isActionPending,
}: {
  worker: WorkerResponse;
  index: number;
  isSelected: boolean;
  onToggleSelect: () => void;
  onView: () => void;
  onEdit: () => void;
  onWake: () => void;
  onSleep: () => void;
  onDelete: () => void;
  isActionPending: boolean;
}) {
  const health = useAgentHealth(worker);

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.03 }}
      layout
    >
      <Card
        className={`glass-card hover-lift ${isSelected ? 'ring-2 ring-primary/50' : ''}`}
      >
        <CardContent className="p-4">
          <div className="flex items-start justify-between mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <button
                onClick={onToggleSelect}
                className="shrink-0"
                title={isSelected ? '取消选择' : '选择'}
                aria-label={isSelected ? '取消选择' : '选择'}
                aria-pressed={isSelected}
              >
                {isSelected ? (
                  <CheckSquare className="w-4 h-4 text-primary" aria-hidden="true" />
                ) : (
                  <Square
                    className="w-4 h-4 text-muted-foreground/50 hover:text-muted-foreground"
                    aria-hidden="true"
                  />
                )}
              </button>
              <StatusDot phase={worker.phase} />
              <Bot className="w-5 h-5 text-primary shrink-0" aria-hidden="true" />
              <span className="font-medium truncate">{worker.name}</span>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {health && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <div>
                      <HealthRingCompact score={health.overall} size={24} />
                    </div>
                  </TooltipTrigger>
                  <TooltipContent>
                    <p className="text-xs font-medium">健康评分: {health.overall}/100 ({health.label})</p>
                    <p className="text-[10px] text-muted-foreground">可用性 {health.availability} · 稳定性 {health.stability} · 就绪度 {health.readiness}</p>
                  </TooltipContent>
                </Tooltip>
              )}
              <PhaseBadge kind="worker" phase={worker.phase} />
            </div>
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
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">运行时</span>
              <RuntimeBadge runtime={worker.runtime} />
            </div>
            {worker.team && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">团队</span>
                <span className="text-xs truncate ml-2">{worker.team}</span>
              </div>
            )}
          </div>

          <div className="flex items-center gap-1.5 mt-3 pt-3 border-t border-border">
            <Button variant="ghost" size="sm" className="h-7 text-xs flex-1" onClick={onView}>
              <Eye className="w-3 h-3 mr-1" aria-hidden="true" />
              详情
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs flex-1" onClick={onEdit}>
              <Pencil className="w-3 h-3 mr-1" aria-hidden="true" />
              编辑
            </Button>
          </div>

          <div className="flex items-center gap-1.5 mt-2">
            {(worker.phase === 'Sleeping' || worker.phase === 'Stopped') && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs flex-1"
                onClick={onWake}
                disabled={isActionPending}
              >
                <Sun className="w-3 h-3 mr-1" aria-hidden="true" />
                唤醒
              </Button>
            )}
            {(worker.phase === 'Running' || worker.phase === 'Ready') && (
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs flex-1"
                onClick={onSleep}
                disabled={isActionPending}
              >
                <Moon className="w-3 h-3 mr-1" aria-hidden="true" />
                休眠
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs text-destructive hover:text-destructive"
              onClick={onDelete}
              disabled={isActionPending}
            >
              删除
            </Button>
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
}
