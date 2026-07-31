'use client';

import { useState, type DragEvent } from 'react';
import type { BatchStep, BatchStepType } from '@/lib/batch-workflow-types';
import { StepNode } from './step-node';
import { StepConfigPanel } from './step-config-panel';

interface BatchWorkflowCanvasProps {
  workflow: { id: string; name: string; steps: BatchStep[] };
  onStepsChange: (steps: BatchStep[]) => void;
  workers?: import('@/lib/batch-dry-run').MockWorker[];
}

export function BatchWorkflowCanvas({ workflow, onStepsChange }: BatchWorkflowCanvasProps) {
  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const selectedStep = workflow.steps.find((s) => s.id === selectedId) ?? null;

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    if (dragIndex === null || dragIndex === targetIndex) return;
    const steps = [...workflow.steps];
    const [moved] = steps.splice(dragIndex, 1);
    steps.splice(targetIndex, 0, moved);
    onStepsChange(steps.map((s, i) => ({ ...s, order: i })));
    setDragIndex(null);
  };

  const handleDragOver = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleAddStep = (type: string, position: number) => {
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

  return (
    <div className="flex gap-4 h-full">
      <div className="flex-1 flex flex-col gap-2 min-h-0">
        <div className="flex items-center justify-between mb-1">
          <h3 className="text-sm font-medium">步骤序列</h3>
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
      </div>

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
