'use client';

import { useState, useCallback } from 'react';
import Joyride, { STATUS } from 'react-joyride';
import type { Step } from 'react-joyride';

const TOUR_STORAGE_KEY = 'agentteams-tour-step';
const FINISHED_KEY = 'agentteams-tour-finished';

export const TOUR_STEPS: Step[] = [
  {
    target: '[data-nav-section="workers"]',
    content: 'Workers 页面管理所有 AI Agent 实例，包括生命周期操作、模型绑定和 Matrix 集成配置。',
    title: 'Workers 管理',
    placement: 'right',
  },
  {
    target: '[data-nav-section="teams"]',
    content: 'Teams 页面组织 Worker 分组管理，支持团队拓扑图、Leader 选举和团队内部通信配置。',
    title: '团队协作',
    placement: 'right',
  },
  {
    target: '[data-nav-section="chat"]',
    content: 'Matrix 聊天页面提供与 Agent 的实时对话能力，支持多房间、流式响应和工具调用可见性。',
    title: 'AI 对话',
    placement: 'right',
  },
  {
    target: '.search-input',
    content: '使用全局搜索快速定位 Worker、团队或消息。支持键盘快捷键 ⌘K / Ctrl+K 打开命令面板。',
    title: '全局搜索',
    placement: 'bottom',
  },
  {
    target: '[data-nav-section="batch-operations"]',
    content: '批量操作页面允许编排多步骤工作流，先干跑验证再执行，适用于大规模 Worker 的批量调度。',
    title: '批量操作',
    placement: 'right',
  },
];

function getTourStep(): number {
  if (typeof window === 'undefined') return 0;
  const stored = localStorage.getItem(TOUR_STORAGE_KEY);
  return stored ? parseInt(stored, 10) : 0;
}

function markTourFinished() {
  if (typeof window === 'undefined') return;
  localStorage.setItem(FINISHED_KEY, '1');
  localStorage.removeItem(TOUR_STORAGE_KEY);
}

function clearTourState() {
  if (typeof window === 'undefined') return;
  localStorage.removeItem(TOUR_STORAGE_KEY);
  localStorage.removeItem(FINISHED_KEY);
}

export function Tour({ enabled }: { enabled: boolean }) {
  const [step, setStep] = useState(getTourStep);
  const [running, setRunning] = useState(enabled && !localStorage.getItem(FINISHED_KEY));

  const handleCallback = useCallback(
    (data: { status?: string; step: number }) => {
      const { status, step: currentStep } = data;
      if (status === 'finished' || status === 'skipped') {
        markTourFinished();
        setRunning(false);
      } else if (status === 'completed') {
        localStorage.setItem(TOUR_STORAGE_KEY, String(currentStep + 1));
        setStep(currentStep + 1);
      }
    },
    [],
  );

  const handleRestart = () => {
    clearTourState();
    setStep(0);
    setRunning(true);
  };

  if (!enabled || !running) return null;

  return (
    <Joyride
      steps={TOUR_STEPS.slice(step)}
      run={running}
      stepIndex={step}
      callback={handleCallback}
      styles={{
        options: {
          zIndex: 9999,
          primaryColor: '#10b981',
          textColor: 'hsl(var(--foreground))',
          backgroundColor: 'hsl(var(--background))',
          overlayColor: 'rgba(0,0,0,0.5)',
        },
      }}
      disableCloseOnEsc
      disableOverlayClose
    />
  );
}

export function useTourState() {
  const hasFinished = typeof window !== 'undefined' && localStorage.getItem(FINISHED_KEY) === '1';
  return { restartTour: () => clearTourState(), hasFinished };
}
