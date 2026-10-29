'use client';

import { useState } from 'react';
import { Check, CheckCircle2, MessageSquare, PlayCircle, RefreshCcw, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSectionStore } from '@/lib/section-store';
import { DemoSpaceDialog } from './demo-space-dialog';

const STEPS_KEY = 'agentteams-welcome-steps-done';
const COMPLETED_STEPS_KEY = `${STEPS_KEY}_progress`;

function readDone(): boolean {
  try {
    return localStorage.getItem(STEPS_KEY) === '1';
  } catch {
    return false;
  }
}

function markDone(): void {
  try {
    localStorage.setItem(STEPS_KEY, '1');
  } catch {
    /* localStorage unavailable */
  }
}

function readCompletedSteps(): Record<number, boolean> {
  try {
    const raw = localStorage.getItem(COMPLETED_STEPS_KEY);
    return raw ? (JSON.parse(raw) as Record<number, boolean>) : {};
  } catch {
    return {};
  }
}

function saveCompletedSteps(completed: Record<number, boolean>): void {
  try {
    localStorage.setItem(COMPLETED_STEPS_KEY, JSON.stringify(completed));
  } catch {
    /* localStorage unavailable */
  }
}

/**
 * 三步引导（PRD F8.2 / F8.3 / 方案 v3 C-7）：
 * ① 加入/打开协作空间 → ② 挑一个模板循环 → ③ 发第一条任务消息。
 * 每步支持完成态勾选并持久化（localStorage）；内置示例空间提供不依赖
 * 外部资源的离线全闭环演练（接力卡、审查报告卡、人工干预卡）。
 */
export function WelcomeSteps({ visible }: { visible: boolean }) {
  const [dismissed, setDismissed] = useState(readDone);
  const [completedSteps, setCompletedSteps] = useState<Record<number, boolean>>(readCompletedSteps);
  const [demoOpen, setDemoOpen] = useState(false);
  const setActive = useSectionStore((s) => s.setActiveSection);

  if (!visible || dismissed) return null;

  const finish = () => {
    markDone();
    setDismissed(true);
  };

  const toggleStep = (index: number) => {
    setCompletedSteps((prev) => {
      const next = { ...prev, [index]: !prev[index] };
      saveCompletedSteps(next);
      return next;
    });
  };

  const handleCompleteAll = () => {
    const next = { 0: true, 1: true, 2: true };
    setCompletedSteps(next);
    saveCompletedSteps(next);
  };

  const steps: Array<{
    icon: typeof MessageSquare;
    title: string;
    hint: string;
    go: string;
    goLabel: string;
  }> = [
    {
      icon: MessageSquare,
      title: '① 打开协作空间',
      hint: '空间 = 和 Agent 一起干活的房间',
      go: 'chat',
      goLabel: '进入空间',
    },
    {
      icon: RefreshCcw,
      title: '② 挑一个模板循环',
      hint: '流程画一次，复用无数次（可选）',
      go: 'loops',
      goLabel: '浏览模板',
    },
    {
      icon: Send,
      title: '③ 发第一条任务消息',
      hint: '@Agent 说清做什么，接力开始',
      go: 'chat',
      goLabel: '去发消息',
    },
  ];

  const allCompleted = [0, 1, 2].every((i) => completedSteps[i]);

  return (
    <>
      <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-emerald-500" aria-hidden="true" />
            <p className="text-sm font-semibold">
              三步跑通第一个闭环
              {allCompleted && (
                <span className="ml-2 text-xs font-normal text-emerald-600 dark:text-emerald-400">
                  （已全部完成，棒！）
                </span>
              )}
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              variant="outline"
              size="sm"
              className="h-6 px-2 text-xs gap-1 border-emerald-500/40 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/10"
              onClick={() => setDemoOpen(true)}
            >
              <PlayCircle className="h-3.5 w-3.5" />
              离线体验示例闭环 (免后端)
            </Button>
            <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={finish}>
              跳过（不再显示）
            </Button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          {steps.map((step, idx) => {
            const Icon = step.icon;
            const isDone = Boolean(completedSteps[idx]);

            return (
              <div
                key={step.title}
                className={`rounded-md border p-3 space-y-2 transition-colors ${
                  isDone
                    ? 'border-emerald-500/40 bg-emerald-500/10'
                    : 'border-border/60 bg-background/40'
                }`}
              >
                <div className="flex items-start justify-between gap-1">
                  <p className="text-xs font-medium flex items-center gap-1.5">
                    <Icon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" aria-hidden="true" />
                    <span className={isDone ? 'line-through text-muted-foreground' : ''}>{step.title}</span>
                  </p>
                  <button
                    onClick={() => toggleStep(idx)}
                    className={`h-4 w-4 rounded border flex items-center justify-center transition-colors shrink-0 ${
                      isDone
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-muted-foreground/40 hover:border-foreground'
                    }`}
                    title={isDone ? '取消已完成' : '标记为此步骤已完成'}
                    aria-label={`标记第 ${idx + 1} 步为${isDone ? '未完成' : '已完成'}`}
                  >
                    {isDone && <Check className="h-3 w-3 stroke-[3]" />}
                  </button>
                </div>

                <p className="text-xs text-muted-foreground">{step.hint}</p>

                <div className="flex items-center gap-2 pt-1">
                  <Button
                    variant={isDone ? 'secondary' : 'outline'}
                    size="sm"
                    className="h-6 px-2 text-xs"
                    onClick={() => {
                      toggleStep(idx);
                      setActive(step.go);
                    }}
                  >
                    {isDone ? '再次前往' : step.goLabel}
                  </Button>
                  {isDone && (
                    <span className="text-xs text-emerald-600 dark:text-emerald-400 flex items-center gap-1 font-medium">
                      <CheckCircle2 className="h-3 w-3" />
                      已完成
                    </span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <DemoSpaceDialog
        open={demoOpen}
        onOpenChange={setDemoOpen}
        onCompleteAllSteps={handleCompleteAll}
      />
    </>
  );
}
