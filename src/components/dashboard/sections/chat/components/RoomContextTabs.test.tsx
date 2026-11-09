import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { RoomContextTabs } from './RoomContextTabs';
afterEach(cleanup);
it('keeps notes and counted context entries together on the right', () => {
  const change = vi.fn();
  render(<RoomContextTabs activeTab={null} includeNotes memberCount={2} onTabChange={change} />);
  expect(screen.getByRole('button', { name: '任务便签' })).toHaveAttribute('aria-pressed', 'true');
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
