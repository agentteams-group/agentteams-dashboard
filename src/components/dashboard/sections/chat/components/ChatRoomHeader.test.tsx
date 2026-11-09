import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChatRoomHeader } from './ChatRoomHeader';

afterEach(cleanup);

describe('assistant context controls', () => {
  it('keeps the compact assistant header clear of context chips', () => {
    render(<ChatRoomHeader compact agentRole="operations" roomName="平台助手" sessionDot={{ state: 'idle', runningOnly: false }} memberCount={2} threadCount={0} activePanel={null} onTogglePanel={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '平台助手' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '显示成员' })).toBeNull();
    expect(screen.queryByRole('button', { name: '显示任务' })).toBeNull();
  });
  it('names counted controls by their purpose and opens the corresponding panel', () => {
    const onTogglePanel = vi.fn();
    render(<ChatRoomHeader agentRole="leader" roomName="设计团队助手" sessionDot={{ state: 'idle', runningOnly: false }} memberCount={2} threadCount={7} activePanel={null} onTogglePanel={onTogglePanel} />);
    fireEvent.click(screen.getByRole('button', { name: '显示成员' }));
    expect(onTogglePanel).toHaveBeenLastCalledWith('members');
    fireEvent.click(screen.getByRole('button', { name: '显示话题' }));
    expect(onTogglePanel).toHaveBeenLastCalledWith('thread');
  });

  it('announces the active panel and supports closing it', () => {
    const onTogglePanel = vi.fn();
    render(<ChatRoomHeader agentRole="operations" roomName="平台助手" sessionDot={{ state: 'idle', runningOnly: false }} memberCount={2} threadCount={0} activePanel="members" onTogglePanel={onTogglePanel} />);
    const members = screen.getByRole('button', { name: '隐藏成员' });
    expect(members).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(members);
    expect(onTogglePanel).toHaveBeenCalledWith('members');
  });
});
