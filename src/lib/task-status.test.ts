import { expect, it } from 'vitest';
import { taskStatus } from './task-status';

it('shows Leader review only after every known child completes on an unfinished active task', () => {
  expect(taskStatus('in_progress', { total: 5, completed: 5 }).label).toBe('Leader 验收中');
  expect(taskStatus('submitted', { total: 5, completed: 5 }).label).toBe('Leader 验收中');
  expect(taskStatus('in_progress', { total: 5, completed: 4 }).label).toBe('进行中');
  expect(taskStatus('in_progress', { total: 0, completed: 0 }).label).toBe('进行中');
  expect(taskStatus('completed', { total: 5, completed: 5 }).label).toBe('已完成');
  expect(taskStatus('blocked', { total: 5, completed: 5 }).label).toBe('阻塞');
  expect(taskStatus('cancelled', { total: 5, completed: 5 }).label).toBe('已取消');
});
