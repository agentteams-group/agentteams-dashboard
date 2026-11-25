import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { WorkspaceAgentLinks } from './workspace-agent-links';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useSectionStore } from '@/lib/section-store';
import type { RoomInfo } from './sections/chat/room-info';

afterEach(cleanup);

describe('assistant navigation', () => {
  it('opens the existing Leader DM instead of creating a separate chat session', () => {
    const room: RoomInfo = { id: '!leader:test', name: '设计团队助手', type: 'manager', agentRole: 'leader', members: [] };
    const navigate = vi.fn();
    useHitlInboxStore.setState({ pendingChatRoomId: null });
    useSectionStore.setState({ activeSection: 'tasks' });
    render(<WorkspaceAgentLinks rooms={[room]} activeSection="tasks" onNavigate={navigate} />);
    fireEvent.click(screen.getByRole('button', { name: '与设计团队助手对话' }));
    expect(navigate).toHaveBeenCalledWith('chat');
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!leader:test');
    expect(useSectionStore.getState().activeSection).toBe('chat');
  });
});
