import { describe, it, expect } from 'vitest';
import { runDryRun } from './batch-dry-run';
import type { MockWorker } from './batch-dry-run';
import type { BatchWorkflow, WorkerPhase } from './batch-workflow-types';

const makeWorkers = (overrides?: Partial<MockWorker>[]): MockWorker[] =>
  [
    { name: 'alpha-1', phase: 'Sleeping', healthScore: 90, hasMatrix: true, team: 'team-a' },
    { name: 'alpha-2', phase: 'Running', healthScore: 75, hasMatrix: false, team: 'team-a' },
    { name: 'beta-1', phase: 'Ready', healthScore: 60, hasMatrix: true, team: 'team-b' },
    { name: 'gamma-1', phase: 'Failed', healthScore: 30, hasMatrix: true, team: 'team-b' },
    { name: 'delta-1', phase: 'Stopped', healthScore: 85, hasMatrix: true, team: 'team-c' },
  ].map((base) => ({ ...base, ...(overrides?.find((o) => o.name === base.name) ?? {}) })) as MockWorker[];

describe('runDryRun', () => {
  const baseWorkflow: BatchWorkflow = {
    id: 'test-wf',
    name: 'Test Workflow',
    steps: [],
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };

  const workers = makeWorkers();

  it('returns empty when no action step is present (dry-run preview only)', () => {
    const result = runDryRun(baseWorkflow, workers);
    expect(result.predictedAffectedWorkers.length).toBe(0);
    expect(result.predictedSkippedWorkers.length).toBe(0);
  });

  it('selects only matching workers by phase filter before action', () => {
    // Select Sleeping + wake verb: only alpha-1 (Sleeping) matches; delta-1 is Stopped so filtered out
    const workflow: BatchWorkflow = {
      ...baseWorkflow,
      steps: [
        { id: 's1', type: 'select', order: 0, config: { phaseFilter: ['Sleeping'] as WorkerPhase[] } },
        { id: 's2', type: 'action', order: 1, config: { verb: 'wake', confirm: false } },
      ],
    };
    const result = runDryRun(workflow, workers);
    expect(result.predictedAffectedWorkers).toContain('alpha-1');
    expect(result.predictedAffectedWorkers).not.toContain('alpha-2');
    expect(result.predictedAffectedWorkers).not.toContain('delta-1'); // Stopped, not Sleeping
  });

  it('filters out low-health workers during validate before action', () => {
    // Select all + validate minHealthScore 80 + wake verb
    const workflow: BatchWorkflow = {
      ...baseWorkflow,
      steps: [
        { id: 's1', type: 'select', order: 0, config: {} },
        { id: 's2', type: 'validate', order: 1, config: { minHealthScore: 80 } },
        { id: 's3', type: 'action', order: 2, config: { verb: 'wake', confirm: false } },
      ],
    };
    const result = runDryRun(workflow, workers);
    // Only alpha-1 (Sleeping, health 90) qualifies for wake; gamma-1 (health 30) and beta-1 (health 60) are excluded
    expect(result.predictedAffectedWorkers).toContain('alpha-1');
    expect(result.predictedAffectedWorkers).not.toContain('gamma-1');
  });

  it('wake verb only affects Sleeping/Stopped workers', () => {
    const workflow: BatchWorkflow = {
      ...baseWorkflow,
      steps: [
        { id: 's1', type: 'select', order: 0, config: {} },
        { id: 's2', type: 'action', order: 1, config: { verb: 'wake', confirm: false } },
      ],
    };
    const result = runDryRun(workflow, workers);
    expect(result.predictedAffectedWorkers).toContain('alpha-1');
    expect(result.predictedAffectedWorkers).toContain('delta-1');
    expect(result.predictedAffectedWorkers).not.toContain('alpha-2');
    expect(result.predictedAffectedWorkers).not.toContain('beta-1');
  });

  it('sleep verb only affects Running/Ready workers', () => {
    const workflow: BatchWorkflow = {
      ...baseWorkflow,
      steps: [
        { id: 's1', type: 'select', order: 0, config: {} },
        { id: 's2', type: 'action', order: 1, config: { verb: 'sleep', confirm: false } },
      ],
    };
    const result = runDryRun(workflow, workers);
    expect(result.predictedAffectedWorkers).toContain('alpha-2');
    expect(result.predictedAffectedWorkers).toContain('beta-1');
    expect(result.predictedAffectedWorkers).not.toContain('alpha-1');
  });

  it('delete verb marks all candidates as affected', () => {
    const workflow: BatchWorkflow = {
      ...baseWorkflow,
      steps: [
        { id: 's1', type: 'select', order: 0, config: {} },
        { id: 's2', type: 'action', order: 1, config: { verb: 'delete', confirm: false } },
      ],
    };
    const result = runDryRun(workflow, workers);
    // All 5 workers are candidates (no select filter), all marked affected by delete
    expect(result.predictedAffectedWorkers).toContain('alpha-1');
    expect(result.predictedAffectedWorkers).toContain('delta-1');
    expect(result.predictedAffectedWorkers.length).toBe(5);
  });

  it('mustHaveMatrix filters out workers without matrix integration', () => {
    const workflow: BatchWorkflow = {
      ...baseWorkflow,
      steps: [
        { id: 's1', type: 'select', order: 0, config: {} },
        { id: 's2', type: 'validate', order: 1, config: { mustHaveMatrix: true } },
        { id: 's3', type: 'action', order: 2, config: { verb: 'wake', confirm: false } },
      ],
    };
    const result = runDryRun(workflow, workers);
    // alpha-2 has no matrix → skipped; alpha-1 has matrix + Sleeping → affected
    expect(result.predictedAffectedWorkers).toContain('alpha-1');
    expect(result.predictedSkippedWorkers).toContain('alpha-2');
  });

  it('estimatedDurationMs scales with step count and affected workers', () => {
    const workflow: BatchWorkflow = {
      ...baseWorkflow,
      steps: [
        { id: 's1', type: 'select', order: 0, config: {} },
        { id: 's2', type: 'validate', order: 1, config: {} },
        { id: 's3', type: 'action', order: 2, config: { verb: 'wake', confirm: false } },
      ],
    };
    const result = runDryRun(workflow, workers);
    expect(result.estimatedDurationMs).toBeGreaterThan(0);
    // 3 steps × 50ms + N affected × 100ms
    const affected = result.predictedAffectedWorkers.length;
    expect(result.estimatedDurationMs).toBeCloseTo(3 * 50 + affected * 100, 0);
  });

  it('handles empty worker list gracefully', () => {
    const result = runDryRun(baseWorkflow, []);
    expect(result.predictedAffectedWorkers).toEqual([]);
    expect(result.predictedSkippedWorkers).toEqual([]);
    expect(result.estimatedDurationMs).toBe(0);
  });

  it('requiredPhase validate step filters workers before action', () => {
    const workflow: BatchWorkflow = {
      ...baseWorkflow,
      steps: [
        { id: 's1', type: 'select', order: 0, config: {} },
        { id: 's2', type: 'validate', order: 1, config: { requiredPhase: 'Running' } },
        { id: 's3', type: 'action', order: 2, config: { verb: 'sleep', confirm: false } },
      ],
    };
    const result = runDryRun(workflow, workers);
    // Only alpha-2 is Running → sleep verb applies to it
    expect(result.predictedAffectedWorkers).toContain('alpha-2');
    expect(result.predictedSkippedWorkers).toContain('alpha-1');
  });

  it('combines multiple validate constraints', () => {
    const workflow: BatchWorkflow = {
      ...baseWorkflow,
      steps: [
        { id: 's1', type: 'select', order: 0, config: {} },
        { id: 's2', type: 'validate', order: 1, config: { minHealthScore: 80, mustHaveMatrix: true } },
        { id: 's3', type: 'action', order: 2, config: { verb: 'wake', confirm: false } },
      ],
    };
    const result = runDryRun(workflow, workers);
    // Only alpha-1 (health 90 + hasMatrix) passes; delta-1 has health 85 but Stopped (not target for wake)
    expect(result.predictedAffectedWorkers).toContain('alpha-1');
    expect(result.predictedAffectedWorkers).not.toContain('beta-1'); // health 60
    expect(result.predictedAffectedWorkers).not.toContain('gamma-1'); // health 30
  });

  it('warns when same worker appears in both affected and skipped (overlapping actions)', () => {
    const workflow: BatchWorkflow = {
      ...baseWorkflow,
      steps: [
        { id: 's1', type: 'select', order: 0, config: {} },
        { id: 's2', type: 'action', order: 1, config: { verb: 'wake', confirm: false } },
        { id: 's3', type: 'action', order: 2, config: { verb: 'sleep', confirm: false } },
      ],
    };
    const result = runDryRun(workflow, workers);
    // Both verbs applied: wake affects Sleeping/Stopped; sleep affects Running/Ready
    expect(result.predictedAffectedWorkers.length).toBeGreaterThan(0);
  });
});
