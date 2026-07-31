'use client';

import { useState, DragEvent } from 'react';
import type { BatchStep, BatchStepType, BatchWorkflow } from '@/lib/batch-workflow-types';
import { StepNode } from './step-node';
import { StepConfigPanel } from './step-config-panel';
import { AlertTriangle, Play, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { runDryRun } from '@/lib/batch-dry-run';
import type { MockWorker } from '@/lib/batch-dry-run';
import { ExecutionLog } from '@/components/batch-execution/execution-log';
import type { BatchExecutionResult, ExecutionLogEntry } from '@/lib/batch-workflow-types';

interface WorkflowCanvasProps {
  workflow: {
    id: string;
    name: string;
    steps: BatchStep[];
  };
  onStepsChange: (steps: BatchStep[]) => void;
  workers?: MockWorker[];
}

export function WorkflowCanvas({ workflow, onStepsChange, workers = [] }: WorkflowCanvasProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [dryRunResult, setDryRunResult] = useState<ReturnType<typeof runDryRun> | null>(null);
  const [executionResult, setExecutionResult] = useState<BatchExecutionResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);

  const selectedStep = workflow.steps.find((s) => s.id === selectedId) ?? null;

  const handleDragStart = (e: DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === targetIndex) return;
    const steps = [...workflow.steps];
    const [moved] = steps.splice(dragIndex, 1);
    steps.splice(targetIndex, 0, moved);
    onStepsChange(steps.map((s, i) => ({ ...s, order: i })));
    setDragIndex(null);
  };

  const handleDragOver = (e: DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleAddStep = (type: BatchStepType, position: number) => {
    const newStep: BatchStep = {
      id: `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type: type as BatchStep['type'],
      order: position,
      config: {},
    };
    const steps = [...workflow.steps];
    steps.splice(position, 0, newStep);
    onStepsChange(steps.map((s, i) => ({ ...s, order: i })));
    setSelectedId(newStep.id);
  };

  const handleUpdateStep = (updated: BatchStep) => {
    onStepsChange(workflow.steps.map((s) => (s.id === updated.id ? updated : s)));
  };

  const handleDeleteStep = (id: string) => {
    onStepsChange(workflow.steps.filter((s) => s.id !== id).map((s, i) => ({ ...s, order: i })));
    if (selectedId === id) setSelectedId(null);
  };

  const handleMoveUp = () => {
    if (!selectedId) return;
    const idx = workflow.steps.findIndex((s) => s.id === selectedId);
    if (idx <= 0) return;
    const steps = [...workflow.steps];
    [steps[idx - 1], steps[idx]] = [steps[idx], steps[idx - 1]];
    onStepsChange(steps.map((s, i) => ({ ...s, order: i })));
  };

  const handleMoveDown = () => {
    if (!selectedId) return;
    const idx = workflow.steps.findIndex((s) => s.id === selectedId);
    if (idx < 0 || idx >= workflow.steps.length - 1) return;
    const steps = [...workflow.steps];
    [steps[idx], steps[idx + 1]] = [steps[idx + 1], steps[idx]];
    onStepsChange(steps.map((s, i) => ({ ...s, order: i })));
  };

  const handleDryRun = () => {
    const wf: BatchWorkflow = {
      id: workflow.id,
      name: workflow.name,
      steps: workflow.steps,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    const result = runDryRun(wf, workers);
    setDryRunResult(result);
    setExecutionResult(null);
  };

  const handleExecute = async () => {
    setIsExecuting(true);
    // Simulate sequential step execution
    const logEntries: ExecutionLogEntry[] = [];
    for (const step of workflow.steps) {
      const startedAt = Date.now();
      // Simulate processing time
      await new Promise((r) => setTimeout(r, 300));
      const completedAt = Date.now();
      logEntries.push({
        stepId: step.id,
        stepOrder: step.order,
        stepType: step.type,
        status: 'completed',
        startedAt,
        completedAt,
        affectedWorkers: [],
      });
    }
    setExecutionResult({
      workflowId: workflow.id,
      workflowName: workflow.name,
      startedAt: Date.now() - workflow.steps.length * 300,
      completedAt: Date.now(),
      status: 'completed',
      steps: logEntries,
      totalAffected: workers.length,
      totalFailed: 0,
    });
    setIsExecuting(false);
  };

  const dryRunPassed = dryRunResult && dryRunResult.predictedFailures.length === 0;

  return (
    <div className="flex gap-4 h-full">
      {/* Steps list */}
      <div className="flex-1 flex flex-col gap-2 min-h-0">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium">步骤序列</h3>
          <div className="flex gap-1">
            <Button variant="outline" size="sm" onClick={handleDryRun} disabled={isExecuting}>
              <RotateCcw className="h-3 w-3 mr-1" />干跑
            </Button>
            <Button size="sm" onClick={handleExecute} disabled={isExecuting || workflow.steps.length === 0}>
              <Play className="h-3 w-3 mr-1" />执行
            </Button>
          </div>
        </div>

        <div className="space-y-2 flex-1 overflow-y-auto">
          {workflow.steps.map((step, index) => (
            <div key={step.id} onDragOver={(e) => handleDragOver(e, index)} onDrop={(e) => handleDrop(e, index)}>
              <StepNode
                step={step}
                index={index}
                total={workflow.steps.length}
                selected={selectedId === step.id}
                onDragStart={handleDragStart}
                onSelect={() => setSelectedId(step.id === selectedId ? null : step.id)}
                onMoveUp={handleMoveUp}
                onMoveDown={handleMoveDown}
                onDelete={() => handleDeleteStep(step.id)}
              />
              {/* Connector line */}
              {index < workflow.steps.length - 1 && (
                <div className="ml-4 h-2 border-l border-dashed border-border/50" />
              )}
            </div>
          ))}
          {workflow.steps.length === 0 && (
            <div className="text-center py-8 text-sm text-muted-foreground border-2 border-dashed rounded-lg">
              点击右侧面板添加步骤
            </div>
          )}
        </div>

        {/* Dry-run results */}
        {dryRunResult && (
          <div className={`rounded-lg border p-3 text-xs space-y-1 ${dryRunPassed ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'}`}>
            <p className="font-medium">{dryRunPassed ? '干跑通过' : '干跑有警告'}</p>
            <p>预计影响 <span className="font-mono text-emerald-500">{dryRunResult.predictedAffectedWorkers.length}</span> 个 Worker</p>
            {dryRunResult.predictedSkippedWorkers.length > 0 && (
              <p>预计跳过 <span className="font-mono text-amber-500">{dryRunResult.predictedSkippedWorkers.length}</span> 个</p>
            )}
            {dryRunResult.predictedFailures.length > 0 && (
              <div className="text-red-500">
                {dryRunResult.predictedFailures.slice(0, 3).map((f) => (
                  <p key={`${f.worker}-${f.stepId}`}>· {f.worker} (step {f.stepId})</p>
                ))}
              </div>
            )}
            <p className="text-muted-foreground">预估耗时: {(dryRunResult.estimatedDurationMs / 1000).toFixed(1)}s</p>
          </div>
        )}

        {/* Execution results */}
        {executionResult && !isExecuting && (
          <ExecutionLog result={executionResult} />
        )}
      </div>

      {/* Config panel */}
      <div className="w-64 shrink-0 border-l pl-4 pt-1 overflow-y-auto">
        <StepConfigPanel
          step={selectedStep}
          onUpdate={handleUpdateStep}
          onAddStep={(type, position) => handleAddStep(type, position ?? workflow.steps.length)}
          stepIndex={workflow.steps.findIndex((s) => s.id === selectedId)}
        />
      </div>
    </div>
  );
}
