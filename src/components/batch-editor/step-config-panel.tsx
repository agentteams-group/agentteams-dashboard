'use client';

import { useState } from 'react';
import { Plus, Bot } from 'lucide-react';
import type { BatchStep, BatchStepType, SelectConfig, ValidateConfig, ActionConfig, NotifyConfig, WorkerPhase } from '@/lib/batch-workflow-types';
import { DEFAULT_STEPS, STEP_TYPE_LABELS } from '@/lib/batch-workflow-types';
import { v4 as uuidv4 } from 'uuid';

export interface StepConfigPanelProps {
  step: BatchStep | null;
  onUpdate: (step: BatchStep) => void;
  onAddStep: (type: BatchStepType, position?: number) => void;
  stepIndex: number;
}

const WORKER_PHASES: { value: string; label: string }[] = [
  { value: 'Sleeping', label: '睡眠中' },
  { value: 'Running', label: '运行中' },
  { value: 'Ready', label: '就绪' },
  { value: 'Failed', label: '失败' },
  { value: 'Stopped', label: '已停止' },
];

export function StepConfigPanel({ step, onUpdate, onAddStep, stepIndex }: StepConfigPanelProps) {
  if (!step) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-muted-foreground">选择左侧步骤以编辑配置，或添加新步骤。</p>
        <div className="space-y-2">
          {(['select', 'validate', 'action', 'notify'] as BatchStepType[]).map((t) => (
            <button
              key={t}
              onClick={() => onAddStep(t, stepIndex + 1)}
              className="w-full flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-border/50 hover:border-emerald-500 hover:bg-emerald-500/5 transition-colors text-sm"
            >
              <Plus className="h-4 w-4 text-muted-foreground" />
              添加 {STEP_TYPE_LABELS[t]} 步骤
            </button>
          ))}
        </div>
      </div>
    );
  }

  switch (step.type) {
    case 'select':
      return <SelectConfigEditor config={step.config as SelectConfig} onChange={(c) => onUpdate({ ...step, config: c })} />;
    case 'validate':
      return <ValidateConfigEditor config={step.config as ValidateConfig} onChange={(c) => onUpdate({ ...step, config: c })} />;
    case 'action':
      return <ActionConfigEditor config={step.config as ActionConfig} onChange={(c) => onUpdate({ ...step, config: c })} />;
    case 'notify':
      return <NotifyConfigEditor config={step.config as NotifyConfig} onChange={(c) => onUpdate({ ...step, config: c })} />;
    default:
      return null;
  }
}

function SelectConfigEditor({
  config,
  onChange,
}: {
  config: SelectConfig;
  onChange: (config: SelectConfig) => void;
}) {
  const handlePhaseToggle = (phase: string) => {
    const current = config.phaseFilter ?? [];
    const next = current.includes(phase as typeof current[number])
      ? current.filter((p) => p !== phase)
      : [...current, phase];
    onChange({ ...config, phaseFilter: next as SelectConfig['phaseFilter'] });
  };

  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">筛选条件</label>
        <input
          type="text"
          value={config.filter ?? ''}
          placeholder="关键词过滤 Worker 名称…"
          onChange={(e) => onChange({ ...config, filter: e.target.value })}
          className="w-full text-sm rounded-md border bg-background px-2 py-1"
        />
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">Phase 过滤（多选）</label>
        <div className="flex flex-wrap gap-2">
          {WORKER_PHASES.map((p) => (
            <button
              key={p.value}
              onClick={() => handlePhaseToggle(p.value)}
              className={`px-2 py-1 rounded text-xs border transition-colors ${
                (config.phaseFilter ?? []).includes(p.value as WorkerPhase)
                  ? 'bg-emerald-500/20 border-emerald-500 text-emerald-500'
                  : 'border-border text-muted-foreground hover:border-emerald-500'
              }`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function ValidateConfigEditor({
  config,
  onChange,
}: {
  config: ValidateConfig;
  onChange: (config: ValidateConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">要求 Phase</label>
        <select
          value={config.requiredPhase ?? ''}
          onChange={(e) => onChange({ ...config, requiredPhase: (e.target.value || undefined) as ValidateConfig['requiredPhase'] })}
          className="w-full text-sm rounded-md border bg-background px-2 py-1"
        >
          <option value="">任意</option>
          {WORKER_PHASES.map((p) => (
            <option key={p.value} value={p.value}>{p.label}</option>
          ))}
        </select>
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">最低健康评分</label>
        <input
          type="number"
          min={0}
          max={100}
          value={config.minHealthScore ?? 0}
          onChange={(e) => onChange({ ...config, minHealthScore: Number(e.target.value) })}
          className="w-full text-sm rounded-md border bg-background px-2 py-1"
        />
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={config.mustHaveMatrix ?? false}
          onChange={(e) => onChange({ ...config, mustHaveMatrix: e.target.checked })}
        />
        必须完成 Matrix 集成
      </label>
    </div>
  );
}

function ActionConfigEditor({
  config,
  onChange,
}: {
  config: ActionConfig;
  onChange: (config: ActionConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">动作类型</label>
        <select
          value={config.verb}
          onChange={(e) => onChange({ ...config, verb: e.target.value as ActionConfig['verb'] })}
          className="w-full text-sm rounded-md border bg-background px-2 py-1"
        >
          <option value="wake">唤醒</option>
          <option value="ensure-ready">确保就绪</option>
          <option value="sleep">睡眠</option>
          <option value="delete">删除</option>
        </select>
      </div>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={config.confirm}
          onChange={(e) => onChange({ ...config, confirm: e.target.checked })}
        />
        执行前确认
      </label>
    </div>
  );
}

function NotifyConfigEditor({
  config,
  onChange,
}: {
  config: NotifyConfig;
  onChange: (config: NotifyConfig) => void;
}) {
  return (
    <div className="space-y-3">
      <div>
        <label className="text-xs text-muted-foreground block mb-1">通知渠道</label>
        <select
          value={config.channel}
          onChange={(e) => onChange({ ...config, channel: e.target.value as NotifyConfig['channel'] })}
          className="w-full text-sm rounded-md border bg-background px-2 py-1"
        >
          <option value="matrix">Matrix</option>
          <option value="slack">Slack</option>
          <option value="email">Email</option>
        </select>
      </div>
      <div>
        <label className="text-xs text-muted-foreground block mb-1">消息模板</label>
        <textarea
          rows={3}
          value={config.message ?? ''}
          placeholder="批量操作已完成，受影响 Worker: {{count}} 个"
          onChange={(e) => onChange({ ...config, message: e.target.value })}
          className="w-full text-sm rounded-md border bg-background px-2 py-1 resize-none"
        />
      </div>
    </div>
  );
}

/**
 * Quick-add a default workflow with the standard Select → Validate → Action sequence.
 */
export function addDefaultWorkflow() {
  const steps: BatchStep[] = DEFAULT_STEPS.map((s, i) => ({
    ...s,
    id: uuidv4(),
    order: i,
  }));
  return {
    id: `wf-${Date.now()}`,
    name: `工作流 ${new Date().toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}`,
    description: '默认工作流：选择 → 验证 → 执行',
    steps,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}
