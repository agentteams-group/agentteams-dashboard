import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { WorkspaceSectionNav } from './workspace-navigation';

beforeEach(() => useAgentTeamsStore.setState({ userLevel: 3, taskBoardVisible: true }));
afterEach(cleanup);

it('switches among all four asset categories using their existing routes', () => {
  const navigate = vi.fn();
  render(<WorkspaceSectionNav activeSection="models" onNavClick={navigate} />);
  const nav = screen.getByRole('navigation', { name: '资产中心分类' });
  expect(within(nav).getAllByRole('button').map(button => button.textContent)).toEqual(['模型', '工具', '技能', '知识库']);
  fireEvent.click(within(nav).getByRole('button', { name: '工具' }));
  expect(navigate).toHaveBeenCalledWith('tools');
});

it('keeps work views available and honours the existing task-board flag', () => {
  const view = render(<WorkspaceSectionNav activeSection="coding-runs" onNavClick={vi.fn()} />);
  expect(screen.getAllByRole('button').map(button => button.textContent)).toEqual(['待你处理', '任务看板', '产物', '编码执行', '自动化']);
  useAgentTeamsStore.setState({ taskBoardVisible: false });
  view.rerender(<WorkspaceSectionNav activeSection="coding-runs" onNavClick={vi.fn()} />);
  expect(screen.queryByRole('button', { name: '任务看板' })).toBeNull();
  expect(screen.queryByRole('button', { name: '产物' })).toBeNull();
  expect(screen.getByRole('button', { name: '编码执行' })).toHaveAttribute('aria-current', 'page');
});
