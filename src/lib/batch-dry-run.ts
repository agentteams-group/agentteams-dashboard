// Batch Dry-Run Engine
// Simulates workflow execution without making any real changes to the cluster.
// Used for preview before committing to an actual run.

import type {
  BatchWorkflow,
  DryRunResult,
  SelectConfig,
  ValidateConfig,
  ActionConfig,
  BatchStepType,
  WorkerPhase,
} from '@/lib/batch-workflow-types';

export interface MockWorker {
  name: string;
  phase: WorkerPhase;
  healthScore: number;
  hasMatrix: boolean;
  team?: string;
}

/**
 * Run a dry-run simulation against the given workflow and mock worker list.
 * Returns predicted affected workers, skipped workers, and failures.
 */
export function runDryRun(
  workflow: BatchWorkflow,
  workers: MockWorker[],
): DryRunResult {
  const affected = new Set<string>();
  const skipped = new Set<string>();
  const failures: DryRunResult['predictedFailures'] = [];

  // Step 1: Select — find all candidates
  const selectStep = workflow.steps.find((s) => s.type === 'select');
  const selectConfig = selectStep?.config as SelectConfig | undefined;

  let candidates = filterBySelect(workers, selectConfig);

  if (candidates.length === 0) {
    candidates = workers; // default: operate on all if no select step
  }

  // Step 2: Validate — filter by conditions, track who was skipped
  const validateSteps = workflow.steps.filter((s) => s.type === 'validate');
  let preValidateCandidates = [...candidates];
  for (const vStep of validateSteps) {
    const vConfig = vStep.config as ValidateConfig | undefined;
    const before = candidates.length;
    candidates = candidates.filter((w) => satisfiesValidate(w, vConfig));
    // Track workers removed by this validate step
    const skippedNames = new Set(preValidateCandidates.map((w) => w.name));
    candidates.forEach((w) => skippedNames.delete(w.name));
    skippedNames.forEach((name) => skipped.add(name));
    preValidateCandidates = [...candidates];
  }

  // Step 3: Action — mark as affected (simulated only)
  const actionSteps = workflow.steps.filter((s) => s.type === 'action');
  for (const aStep of actionSteps) {
    const aConfig = aStep.config as ActionConfig | undefined;
    if (aConfig?.verb === 'delete') {
      // Simulate deletion — all candidates would be affected
      candidates.forEach((w) => affected.add(w.name));
    } else if (aConfig?.verb === 'sleep') {
      candidates.forEach((w) => {
        if (w.phase === 'Running' || w.phase === 'Ready') {
          affected.add(w.name);
        } else {
          skipped.add(w.name);
        }
      });
    } else {
      // wake / ensure-ready: affect all candidates that are not already in target state
      candidates.forEach((w) => {
        if (aConfig?.verb === 'wake' && (w.phase === 'Sleeping' || w.phase === 'Stopped')) {
          affected.add(w.name);
        } else if (aConfig?.verb === 'ensure-ready' && w.phase !== 'Ready') {
          affected.add(w.name);
        } else if (!affected.has(w.name) && !skipped.has(w.name)) {
          skipped.add(w.name);
        }
      });
    }
  }

  // Notify steps don't affect workers
  const notifySteps = workflow.steps.filter((s) => s.type === 'notify');
  void notifySteps;

  // Compute estimated duration (50ms per step, 100ms per affected worker)
  const estimatedDurationMs = workflow.steps.length * 50 + affected.size * 100;

  return {
    predictedAffectedWorkers: Array.from(affected),
    predictedSkippedWorkers: Array.from(skipped),
    predictedFailures: failures,
    estimatedDurationMs,
  };
}

/**
 * Apply select filter criteria to candidate workers.
 */
function filterBySelect(workers: MockWorker[], config?: SelectConfig): MockWorker[] {
  if (!config) return workers;
  return workers.filter((w) => {
    if (config.teamFilter && w.team !== config.teamFilter) return false;
    if (config.phaseFilter && !config.phaseFilter.includes(w.phase)) return false;
    if (config.workerNames && !config.workerNames.includes(w.name)) return false;
    return true;
  });
}

/**
 * Check whether a worker passes validation constraints.
 */
function satisfiesValidate(worker: MockWorker, config?: ValidateConfig): boolean {
  if (!config) return true;
  if (config.requiredPhase && worker.phase !== config.requiredPhase) return false;
  if (config.minHealthScore && worker.healthScore < config.minHealthScore) return false;
  if (config.mustHaveMatrix && !worker.hasMatrix) return false;
  return true;
}
