'use client';

/**
 * 循环预演仿真对话框（方案 v3 F-3）。
 *
 * 解决问题：
 * 循环作者在画布中绘制完成节点与退回条件边后，发布前无法直接感知流转过程与潜在断点。
 * 本组件从 start 出发，基于拓扑连线推导演练执行步骤（Agent/人工/审查/终点），
 * 并动态识别孤立节点或死循环，提供“步骤仿真”逐节点推演动画。
 */

import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  type LoopDefinition,
  simulateLoopDryRun,
} from '@/lib/loop-definition';
import {
  AlertTriangle,
  Bot,
  CheckCircle2,
  Play,
  RotateCcw,
  Sparkles,
} from 'lucide-react';

interface LoopDryRunDialogProps {
  definition: LoopDefinition | null;
  open: boolean;
  onOpenChange: (_open: boolean) => void;
}

export function LoopDryRunDialog({
  definition,
  open,
  onOpenChange,
}: LoopDryRunDialogProps) {
  const [activeStepIndex, setActiveStepIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);

  const dryRun = useMemo(() => {
    if (!definition) return null;
    return simulateLoopDryRun(definition);
  }, [definition]);

  const handlePlaySimulation = () => {
    if (!dryRun || dryRun.steps.length === 0) return;
    setIsPlaying(true);
    setActiveStepIndex(0);

    let current = 0;
    const timer = setInterval(() => {
      current++;
      if (current >= dryRun.steps.length) {
        clearInterval(timer);
        setIsPlaying(false);
      } else {
        setActiveStepIndex(current);
      }
    }, 600);
  };

  if (!definition || !dryRun) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader className="border-b border-border/60 pb-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" aria-hidden />
              <DialogTitle className="text-base font-semibold">循环预演仿真 (Dry Run)</DialogTitle>
            </div>
            <Badge
              variant="outline"
              className={
                dryRun.reachable
                  ? 'border-emerald-500/40 text-emerald-600 bg-emerald-500/10'
                  : 'border-red-500/40 text-red-600 bg-red-500/10'
              }
            >
              {dryRun.reachable ? '拓扑可达 (Reachable)' : '终点不可达'}
            </Badge>
          </div>
          <DialogDescription className="text-xs text-muted-foreground mt-0.5">
            循环：<span className="font-medium text-foreground">{definition.name}</span> (v{definition.version}) · 推演执行步骤与条件分支
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          {dryRun.warnings.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-3 space-y-1 text-xs text-amber-800 dark:text-amber-300">
              <div className="flex items-center gap-1.5 font-medium">
                <AlertTriangle className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                <span>分支与拓扑提示：</span>
              </div>
              <ul className="list-disc pl-5 space-y-0.5">
                {dryRun.warnings.map((w) => (
                  <li key={w}>{w}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground">推演执行序列（共 {dryRun.steps.length} 步）</p>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                disabled={isPlaying}
                onClick={handlePlaySimulation}
              >
                <Play className="h-3 w-3" />
                {isPlaying ? '仿真推演中...' : '开始步骤仿真'}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={() => setActiveStepIndex(0)}
              >
                <RotateCcw className="h-3 w-3" />
                重置
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            {dryRun.steps.map((step, idx) => {
              const isCurrent = idx === activeStepIndex;
              const isPassed = idx < activeStepIndex;

              return (
                <div
                  key={step.nodeId + idx}
                  className={`flex items-center justify-between p-2.5 rounded-md border transition-all text-xs ${
                    isCurrent
                      ? 'border-primary bg-primary/10 ring-1 ring-primary/40 font-medium'
                      : isPassed
                        ? 'border-border/60 bg-muted/20 opacity-80'
                        : 'border-border/40 bg-background/50'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-muted-foreground w-5 text-right">{step.stepNumber}.</span>
                    <span className="font-medium text-foreground">{step.nodeLabel}</span>
                    <Badge variant="outline" className="text-xs px-1.5 py-0">
                      {step.nodeType}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-2">
                    {step.assignee && (
                      <span className="flex items-center gap-1 text-muted-foreground text-xs">
                        <Bot className="h-3 w-3" />
                        @{step.assignee}
                      </span>
                    )}
                    {isPassed && <CheckCircle2 className="h-3.5 w-3.5 text-status-done shrink-0" />}
                    {isCurrent && <span className="text-xs text-primary animate-pulse font-medium">执行中</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border/60 pt-3">
          <span className="text-xs text-muted-foreground">仿真基于静态拓扑连线推导</span>
          <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
            完成查看
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
