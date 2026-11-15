import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ProjectDagSvg } from './project-dag-svg';
import { buildProjectDag } from '@/lib/project-dag';
import type { BoardTask } from '@/hooks/use-task-board';

afterEach(cleanup);

it('uses neutral nodes and edges, marks only completed tasks with a green check, and preserves selection', () => {
  const tasks = ['completed', 'in_progress', 'pending'].map((status, i) => ({ runId: String(i), title: `任务${i}`, status, assignedTo: `worker${i}`, projectId: 'project', roomId: '', dependsOn: i ? ['0'] : [], createdAt: 0, outcome: null, source: 'api' } as BoardTask));
  render(<ProjectDagSvg dag={buildProjectDag(tasks, 'project')} nodeColors={{ unknown: { fill: 'purple', stroke: 'orange', text: 'cyan' } }} neutral currentNodeId="0" selectedNodeId="1" onNodeClick={() => {}} />);
  const graph = screen.getByRole('group', { name: '项目任务依赖图' });
  expect(graph.querySelectorAll('[data-completed="true"]')).toHaveLength(1);
  expect(graph.querySelector('[data-completed="true"]')).toHaveAttribute('stroke', '#16a34a');
  expect(graph.querySelectorAll('circle')).toHaveLength(0);
  expect([...graph.querySelectorAll('rect')].every(rect => ['none', 'var(--card)'].includes(rect.getAttribute('fill') ?? ''))).toBe(true);
  expect([...graph.querySelectorAll('path:not([data-completed])')].every(path => !['orange', '#f59e0b', '#22d3ee'].includes(path.getAttribute('stroke') ?? ''))).toBe(true);
  expect(screen.getByRole('button', { name: '任务0 · worker0' })).toHaveAttribute('data-current', 'true');
  expect(screen.getByRole('button', { name: '任务1 · worker1' })).toHaveAttribute('aria-pressed', 'true');
});
