/**
 * AC-W1 / AC-T2: axe-core gate for WorkerCard v2.
 *
 * jsdom has no real layout, so the color-contrast rule is unreliable here and
 * stays disabled (任务书 R8) — AA contrast is verified by token review +
 * Playwright screenshots. Everything else (ARIA, names, roles) must be 0
 * critical violations.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import axe from 'axe-core';
import { TooltipProvider } from '@/components/ui/tooltip';
import { WorkerCard } from './worker-card';
import type { WorkerResponse } from '@/lib/agentteams-api';

const worker: WorkerResponse = {
  name: 'worker-a',
  phase: 'Running',
  state: 'Running',
  containerManaged: true,
  model: 'gpt-5',
  runtime: 'qwenpaw',
  image: 'img:latest',
  containerState: 'running',
  matrixUserID: '@worker-a:server',
  roomID: '!room:server',
  message: '处理工单 #4821',
  team: 'team-alpha',
  role: 'member',
  lastTaskSummary: '处理工单 #4821',
};

function renderCard(isDeleting = false) {
  return render(
    <TooltipProvider>
      <WorkerCard
        worker={worker}
        index={0}
        isSelected={false}
        onToggleSelect={() => {}}
        onView={() => {}}
        onEdit={() => {}}
        onWake={() => {}}
        onSleep={() => {}}
        onEnsureReady={() => {}}
        onDelete={() => {}}
        isActionPending={false}
        isDeleting={isDeleting}
      />
    </TooltipProvider>,
  );
}

async function criticalViolations(container: HTMLElement) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false } },
  });
  return results.violations.filter((v) => v.impact === 'critical');
}

afterEach(cleanup);

describe('WorkerCard accessibility (axe-core)', () => {
  it('has no critical violations in the default state', async () => {
    const { container } = renderCard();
    expect(await criticalViolations(container)).toEqual([]);
  });

  it('has no critical violations while deleting (overlay + progress)', async () => {
    const { container } = renderCard(true);
    expect(await criticalViolations(container)).toEqual([]);
  });
});
