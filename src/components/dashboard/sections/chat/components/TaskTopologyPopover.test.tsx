import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { TaskTopologyPopover } from './TaskTopologyPopover';
import { RoomContextTabs } from './RoomContextTabs';

vi.mock('./RoomTasksPanel', () => ({ RoomTasksPanel: () => <div>真实任务拓扑</div> }));
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('keeps file and member tabs while task rooms use the separate topology popover', () => {
  const select = vi.fn();
  render(<RoomContextTabs activeTab="files" showTasks={false} onTabChange={select} />);
  expect(screen.queryByRole('button', { name: '任务拓扑' })).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '成员' }));
  expect(select).toHaveBeenCalledWith('members');
  expect(screen.getByRole('button', { name: '文件' })).toBeInTheDocument();
});

it('opens on click without inserting a fixed graph into the conversation', () => {
  render(<TaskTopologyPopover roomId="!room:test" />);
  expect(screen.queryByRole('dialog')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: '任务拓扑' }));
  expect(screen.getByRole('dialog', { name: '任务拓扑预览' })).toHaveTextContent('真实任务拓扑');
  fireEvent.click(screen.getByRole('button', { name: '任务拓扑' }));
  expect(screen.queryByRole('dialog')).toBeNull();
});

it('waits for hover intent and stays open when moving into the preview', () => {
  vi.useFakeTimers();
  render(<TaskTopologyPopover roomId="!room:test" />);
  const trigger = screen.getByRole('button', { name: '任务拓扑' });
  fireEvent.pointerEnter(trigger);
  act(() => vi.advanceTimersByTime(250));
  const preview = screen.getByRole('dialog');
  fireEvent.pointerLeave(trigger);
  fireEvent.pointerEnter(preview);
  act(() => vi.advanceTimersByTime(250));
  expect(preview).toBeInTheDocument();
  fireEvent.pointerLeave(preview);
  act(() => vi.advanceTimersByTime(250));
  expect(screen.queryByRole('dialog')).toBeNull();
});
