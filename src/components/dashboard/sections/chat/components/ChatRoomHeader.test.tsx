import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChatRoomHeader } from './ChatRoomHeader';

afterEach(cleanup);

describe('assistant context controls', () => {
  it('keeps the compact assistant header clear of context chips', () => {
    render(<ChatRoomHeader compact agentRole="operations" headerActions={<button>待我处理 · 2</button>} roomName="平台助手" sessionDot={{ state: 'idle', runningOnly: false }} memberCount={2} threadCount={0} activePanel={null} onTogglePanel={vi.fn()} />);
    expect(screen.getByRole('heading', { name: '平台助手' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '显示成员' })).toBeNull();
    expect(screen.queryByRole('button', { name: '显示任务' })).toBeNull();
    expect(screen.queryByRole('button', { name: /空间概览/ })).toBeNull();
    expect(screen.getByRole('button', { name: '待我处理 · 2' })).toBeInTheDocument();
  });
  it('uses the conversation switcher as the sole title with a list entry in the same header', () => {
    render(<ChatRoomHeader compact roomName="平台助手" headerTitle={<button>切换会话</button>} headerLeading={<button>打开空间列表</button>} sessionDot={{ state: 'idle', runningOnly: false }} memberCount={2} threadCount={0} activePanel={null} onTogglePanel={vi.fn()} />);
    expect(screen.queryByRole('heading', { name: '平台助手' })).toBeNull();
    expect(screen.getByRole('button', { name: '切换会话' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '打开空间列表' })).toBeInTheDocument();
  });
  it('names counted controls by their purpose and opens the corresponding panel', () => {
    const onTogglePanel = vi.fn();
    render(<ChatRoomHeader roomName="设计团队助手" sessionDot={{ state: 'idle', runningOnly: false }} memberCount={2} threadCount={7} activePanel={null} onTogglePanel={onTogglePanel} />);
    fireEvent.click(screen.getByRole('button', { name: '显示成员' }));
    expect(onTogglePanel).toHaveBeenLastCalledWith('members');
    fireEvent.click(screen.getByRole('button', { name: '显示话题' }));
    expect(onTogglePanel).toHaveBeenLastCalledWith('thread');
  });

  it('announces the active panel and supports closing it', () => {
    const onTogglePanel = vi.fn();
    render(<ChatRoomHeader roomName="平台助手" sessionDot={{ state: 'idle', runningOnly: false }} memberCount={2} threadCount={0} activePanel="members" onTogglePanel={onTogglePanel} />);
    const members = screen.getByRole('button', { name: '隐藏成员' });
    expect(members).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(members);
    expect(onTogglePanel).toHaveBeenCalledWith('members');
  });
});
