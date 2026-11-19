import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RoomContextTabs } from './RoomContextTabs';
afterEach(cleanup);
it('opens panels only on click, not mouse hover', () => {
  const change = vi.fn();
  render(<RoomContextTabs vertical activeTab={null} onTabChange={change} />);
  const tasks = screen.getByRole('button', { name: '任务' });
  fireEvent.pointerEnter(tasks, { pointerType: 'mouse' });
  expect(change).not.toHaveBeenCalled();
  fireEvent.click(tasks);
  expect(change).toHaveBeenCalledOnce();
  expect(change).toHaveBeenCalledWith('tasks');
});
it('keeps notes and counted context entries together on the right', () => {
  const change = vi.fn();
  render(<RoomContextTabs activeTab={null} memberCount={2} onTabChange={change} />);
  expect(screen.queryByRole('button', { name: '任务便签' })).toBeNull();
  expect(screen.queryByRole('button', { name: '概览' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '成员 2' }));
  expect(change).toHaveBeenCalledWith('members');
  fireEvent.click(screen.getByRole('button', { name: '文件' }));
  expect(change).toHaveBeenCalledWith('files');
});
it('keeps icon shortcuts accessible when the right sidebar is collapsed', () => {
  const change = vi.fn();
  render(<RoomContextTabs vertical activeTab={null} onTabChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: '话题' }));
  expect(change).toHaveBeenCalledWith('thread');
});

it('hides members for assistants while retaining task, file and topic entries', () => {
  render(<RoomContextTabs activeTab={null} showMembers={false} onTabChange={vi.fn()} />);
  expect(screen.queryByRole('button', { name: /成员/ })).toBeNull();
  for (const name of ['任务', '文件', '话题']) expect(screen.getByRole('button', { name })).toBeInTheDocument();
});
