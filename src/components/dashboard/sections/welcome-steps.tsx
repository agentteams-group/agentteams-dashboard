'use client';

import { useState } from 'react';
import { MessageSquare, RefreshCcw, Send, Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSectionStore } from '@/lib/section-store';

const STEPS_KEY = 'agentteams-welcome-steps-done';

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

/**
 * 三步引导（PRD F8.2）：① 加入/打开协作空间 → ② 挑一个模板循环 →
 * ③ 发第一条任务消息。空态出现、可跳过、不再打扰（localStorage）。
 * 示例空间/示例循环（F8.3）依赖演示运行时，M4 先做引导骨架。
 */
export function WelcomeSteps({ visible }: { visible: boolean }) {
  const [dismissed, setDismissed] = useState(readDone);
  const setActive = useSectionStore((s) => s.setActiveSection);

  if (!visible || dismissed) return null;

  const finish = () => {
    markDone();
    setDismissed(true);
  };

  const steps: Array<{ icon: typeof MessageSquare; title: string; hint: string; go: string; goLabel: string }> = [
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

  return (
    <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold flex items-center gap-1.5">
          <Sparkles className="h-4 w-4 text-emerald-500" aria-hidden="true" />
          三步跑通第一个闭环
        </p>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-[10px]" onClick={finish}>
          跳过（不再显示）
        </Button>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        {steps.map((step) => {
          const Icon = step.icon;
          return (
            <div key={step.title} className="rounded-md border border-border/60 bg-background/40 p-3 space-y-1.5">
              <p className="text-xs font-medium flex items-center gap-1.5">
                <Icon className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" aria-hidden="true" />
                {step.title}
              </p>
              <p className="text-[10px] text-muted-foreground">{step.hint}</p>
              <Button
                variant="outline"
                size="sm"
                className="h-6 px-2 text-[10px]"
                onClick={() => {
                  finish();
                  setActive(step.go);
                }}
              >
                {step.goLabel}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
