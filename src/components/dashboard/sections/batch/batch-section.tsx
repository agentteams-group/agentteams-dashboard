'use client';

import { useState, useRef } from 'react';
import { Plus, Trash2, Play, Workflow, Pause, Square } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { BatchWorkflowCanvas } from '@/components/batch-editor/canvas-wrapper';
import { addDefaultWorkflow } from '@/components/batch-editor/step-config-panel';
import type {
  BatchStep,
  BatchExecutionResult,
  BatchWorkflow,
  ExecutionLogEntry,
  ExecutionStatus,
} from '@/lib/batch-workflow-types';
import { ExecutionLog } from '@/components/batch-execution/execution-log';
import { ProgressProgressBar } from '@/components/batch-execution/progress-bar';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import type { WorkerResponse } from '@/lib/agentteams-api';
import type { MockWorker } from '@/lib/batch-dry-run';
import { appendExecutionHistory } from '@/lib/batch-execution-history';

/**
 * 批量操作工作流编辑器 — Phase 3, Task 9.1 + 11.x
 */
export function BatchOperationsSection() {
  const [workflows, setWorkflows] = useState<BatchWorkflow[]>(loadWorkflows);
  const [activeId, setActiveId] = useState<string | null>(
    () => loadWorkflows().find((w) => w.steps.length > 0)?.id ?? null,
  );
  const [result, setResult] = useState<BatchExecutionResult | null>(null);
  const [isExecuting, setIsExecuting] = useState(false);
  const [execStatus, setExecStatus] = useState<ExecutionStatus>('idle');
  const [currentStepIndex, setCurrentStepIndex] = useState(0);
  const [currentSteps, setCurrentSteps] = useState<ExecutionLogEntry[]>([]);
  const abortRef = useRef(false);

  const { data: workersData } = useWorkers();
  const mockWorkers = toMockWorkers(workersData ?? []);
  const activeWorkflow = workflows.find((w) => w.id === activeId) ?? null;

  const handleStepsChange = (steps: BatchStep[]) => {
    if (!activeId) return;
    setWorkflows((prev) =>
      prev.map((w) => w.id === activeId ? { ...w, steps, updatedAt: Date.now() } : w),
    );
    setResult(null);
  };

  const handleAddWorkflow = () => {
    const wf = addDefaultWorkflow();
    setWorkflows((prev) => {
      const next = [...prev, wf];
      saveWorkflows(next);
      return next;
    });
    setActiveId(wf.id);
  };

  const handleDeleteWorkflow = (id: string) => {
    setWorkflows((prev) => {
      const next = prev.filter((w) => w.id !== id);
      saveWorkflows(next);
      if (activeId === id) {
        setActiveId(next[0]?.id ?? null);
      }
      return next;
    });
  };

  const handleRenameWorkflow = (id: string, name: string) => {
    setWorkflows((prev) => {
      const next = prev.map((w) => w.id === id ? { ...w, name } : w);
      saveWorkflows(next);
      return next;
    });
  };

  const startExecution = () => {
    setIsExecuting(true);
    setExecStatus('running');
    setCurrentStepIndex(0);
    setCurrentSteps([]);
    abortRef.current = false;
  };

  const runNextStep = async (
    workflow: BatchWorkflow,
    steps: ExecutionLogEntry[],
    index: number,
  ): Promise<ExecutionLogEntry[]> => {
    if (index >= workflow.steps.length || abortRef.current) {
      return steps;
    }

    const step = workflow.steps[index];
    const startedAt = Date.now();
    setCurrentStepIndex(index);
    setCurrentSteps((prev) => [...prev, {
      stepId: step.id,
      stepOrder: index,
      stepType: step.type,
      status: 'running',
      startedAt,
      completedAt: startedAt,
      affectedWorkers: [],
    }]);

    // Simulate processing time with variable delay
    const delay = 400 + Math.random() * 300;
    await new Promise((r) => setTimeout(r, delay));

    if (abortRef.current) {
      // Mark remaining steps as skipped
      const skippedSteps: ExecutionLogEntry[] = workflow.steps.slice(index).map((s, i) => ({
        stepId: s.id,
        stepOrder: index + i,
        stepType: s.type,
        status: 'skipped',
        startedAt: Date.now(),
        completedAt: Date.now(),
        affectedWorkers: [],
      }));
      return [...steps, {
        stepId: step.id,
        stepOrder: index,
        stepType: step.type,
        status: 'skipped',
        startedAt,
        completedAt: Date.now(),
        affectedWorkers: [],
      }, ...skippedSteps];
    }

    const completedAt = Date.now();
    const newSteps = [...steps, {
      stepId: step.id,
      stepOrder: index,
      stepType: step.type,
      status: 'completed',
      startedAt,
      completedAt,
      affectedWorkers: mockWorkers.slice(0, Math.floor(mockWorkers.length * 0.6)).map((w) => w.name),
    }];

    // Recurse for next step
    return runNextStep(workflow, newSteps as ExecutionLogEntry[], index + 1);
  };

  const handleExecute = async () => {
    if (!activeWorkflow || isExecuting) return;
    startExecution();
    try {
      const finalSteps = await runNextStep(activeWorkflow, [], 0);
      const totalAffected = new Set(
        finalSteps.flatMap((s) => s.affectedWorkers),
      ).size;
      const finishedAt = Date.now();
      const execResult: BatchExecutionResult = {
        workflowId: activeWorkflow.id,
        workflowName: activeWorkflow.name,
        startedAt: activeWorkflow.steps.reduce(
          (min, s) => Math.min(min, s.startedAt ?? Infinity), Infinity,
        ),
        completedAt: finishedAt,
        status: abortRef.current ? 'paused' : 'completed',
        steps: finalSteps,
        totalAffected,
        totalFailed: 0,
      };
      setResult(execResult);
      setExecStatus(execResult.status);
      appendExecutionHistory({
        id: `ex-${Date.now()}`,
        workflowId: activeWorkflow.id,
        workflowName: activeWorkflow.name,
        startedAt: execResult.startedAt,
        completedAt: finishedAt,
        status: execResult.status,
        totalAffected,
        totalFailed: 0,
      });
    } catch {
      setExecStatus('failed');
      setIsExecuting(false);
    }
    setIsExecuting(false);
  };

  const handleAbort = () => {
    abortRef.current = true;
    setExecStatus('paused');
  };

  const handleContinue = () => {
    if (!activeWorkflow) return;
    abortRef.current = false;
    setExecStatus('running');
    setIsExecuting(true);
    runNextStep(activeWorkflow, currentSteps, currentStepIndex).then((finalSteps) => {
      const totalAffected = new Set(finalSteps.flatMap((s) => s.affectedWorkers)).size;
      const finishedAt = Date.now();
      const execResult: BatchExecutionResult = {
        workflowId: activeWorkflow.id,
        workflowName: activeWorkflow.name,
        startedAt: activeWorkflow.steps.reduce(
          (min, s) => Math.min(min, s.startedAt ?? Infinity), Infinity,
        ),
        completedAt: finishedAt,
        status: 'completed',
        steps: finalSteps,
        totalAffected,
        totalFailed: 0,
      };
      setResult(execResult);
      setExecStatus('completed');
      setIsExecuting(false);
    });
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold flex items-center gap-2">
            <Workflow className="h-5 w-5 text-emerald-500" />
            批量操作工作流
          </h2>
          <p className="text-sm text-muted-foreground mt-0.5">
            编排多步骤执行流程，支持干跑验证后批量下发到指定 Worker
          </p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" onClick={handleAddWorkflow}>
            <Plus className="h-3.5 w-3.5 mr-1" />新建工作流
          </Button>
          {isExecuting ? (
            <Button variant="outline" size="sm" onClick={handleAbort}>
              <Square className="h-3.5 w-3.5 mr-1" />中止
            </Button>
          ) : (
            <Button size="sm" onClick={handleExecute} disabled={!activeWorkflow || activeWorkflow.steps.length === 0}>
              <Play className="h-3.5 w-3.5 mr-1" />
              {execStatus === 'paused' ? '继续执行' : '执行'}
            </Button>
          )}
        </div>
      </div>

      {/* Progress bar (shown when running/paused/completed) */}
      {(isExecuting || result) && activeWorkflow && (
        <ProgressProgressBar
          steps={currentSteps.length > 0 ? currentSteps : (result?.steps ?? [])}
          totalSteps={activeWorkflow.steps.length}
          currentStepIndex={isExecuting ? currentStepIndex : (result?.steps.filter((s) => s.status === 'completed').length ?? 0)}
          status={execStatus as Parameters<typeof ProgressProgressBar>[0]['status']}
          onContinue={execStatus === 'paused' ? handleContinue : undefined}
          onAbort={isExecuting ? handleAbort : undefined}
        />
      )}

      {/* Workspace */}
      <div className="grid grid-cols-[220px_1fr] gap-4 h-[560px]">
        {/* Workflow list sidebar */}
        <div className="border rounded-xl overflow-hidden bg-card flex flex-col">
          <div className="px-3 py-2 border-b bg-muted/30">
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">工作流列表</h3>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1">
            {workflows.map((wf) => (
              <div
                key={wf.id}
                onClick={() => setActiveId(wf.id)}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md cursor-pointer text-sm transition-colors ${
                  activeId === wf.id ? 'bg-emerald-500/15 text-emerald-500' : 'hover:bg-muted/50 text-muted-foreground'
                }`}
              >
                <span className="flex-1 truncate">{wf.name}</span>
                <button
                  onClick={(e) => { e.stopPropagation(); handleDeleteWorkflow(wf.id); }}
                  className="opacity-0 hover:opacity-100 hover:text-red-500 p-0.5"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            {workflows.length === 0 && (
              <p className="text-xs text-muted-foreground text-center py-4">暂无工作流</p>
            )}
          </div>
          <div className="px-3 py-2 border-t bg-muted/30 text-[11px] text-muted-foreground">
            {workflows.length} 个工作流 · {mockWorkers.length} 个 Worker
          </div>
        </div>

        {/* Main canvas */}
        <div className="border rounded-xl overflow-hidden bg-card flex flex-col min-h-0">
          {activeWorkflow ? (
            <>
              <div className="px-4 py-2.5 border-b bg-muted/30 flex items-center gap-3">
                <Input
                  value={activeWorkflow.name}
                  onChange={(e) => handleRenameWorkflow(activeWorkflow.id, e.target.value)}
                  className="h-7 text-sm max-w-xs"
                />
                <span className="text-xs text-muted-foreground">
                  {activeWorkflow.steps.length} 步骤 · 约影响 {mockWorkers.length} Worker
                </span>
              </div>
              <div className="flex-1 p-4 min-h-0 overflow-hidden">
                <BatchWorkflowCanvas
                  workflow={activeWorkflow}
                  onStepsChange={handleStepsChange}
                  workers={mockWorkers}
                />
              </div>
              {result && !isExecuting && (
                <div className="border-t p-3">
                  <ExecutionLog result={result} />
                </div>
              )}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-sm text-muted-foreground">
              选择一个工作流或创建新的
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function loadWorkflows(): BatchWorkflow[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = localStorage.getItem('batch-workflows');
    if (raw) return JSON.parse(raw) as BatchWorkflow[];
  } catch { /* ignore */ }
  return [addDefaultWorkflow()];
}

function saveWorkflows(wfs: BatchWorkflow[]) {
  if (typeof window === 'undefined') return;
  localStorage.setItem('batch-workflows', JSON.stringify(wfs));
}

function toMockWorkers(data: WorkerResponse[]): MockWorker[] {
  return data.map((w) => ({
    name: w.name,
    phase: (w.phase ?? 'Sleeping') as MockWorker['phase'],
    healthScore: 85,
    hasMatrix: !!w.matrixUserID,
    team: w.team ?? undefined,
  }));
}
