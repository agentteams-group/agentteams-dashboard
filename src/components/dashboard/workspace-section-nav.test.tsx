import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { WorkspaceNavigation } from './workspace-navigation';

beforeEach(() => useAgentTeamsStore.setState({ userLevel: 3, taskBoardVisible: true }));
afterEach(cleanup);

it('switches among all five asset categories using their existing routes', () => {
  const navigate = vi.fn();
  render(<WorkspaceNavigation activeSection="models" countMap={{}} sectionsWithNotifications={new Set()} onNavClick={navigate} />);
  const nav = screen.getByRole('group', { name: '资产中心分类' });
  expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(['模型', '工具', '技能', '知识库', '文件']);
  fireEvent.click(within(nav).getByRole('button', { name: '工具' }));
  expect(navigate).toHaveBeenCalledWith('tools');
});

it('keeps work views available and honours the existing task-board flag', () => {
  const view = render(<WorkspaceNavigation activeSection="coding-runs" countMap={{}} sectionsWithNotifications={new Set()} onNavClick={vi.fn()} />);
  expect(within(screen.getByRole('group', { name: '工作台分类' })).getAllByRole('button').map(button => button.textContent)).toEqual(['待你处理', '任务看板', '产物', '编码执行', '自动化', 'Tracing']);
  useAgentTeamsStore.setState({ taskBoardVisible: false });
  view.rerender(<WorkspaceNavigation activeSection="coding-runs" countMap={{}} sectionsWithNotifications={new Set()} onNavClick={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '任务看板' })).toBeNull();
  expect(screen.queryByRole('button', { name: '产物' })).toBeNull();
  expect(screen.getByRole('button', { name: '编码执行' })).toHaveAttribute('aria-current', 'page');
});
