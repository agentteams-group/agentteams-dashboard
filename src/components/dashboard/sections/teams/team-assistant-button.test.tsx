import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TeamResponse } from '@/lib/agentteams-api';
import { TeamAssistantButton } from './team-assistant-button';

const state = vi.hoisted(() => ({ username: 'alice', userId: '@alice:test', access: 'joined', rooms: ['!private:test'] }));
const openRoom = vi.hoisted(() => vi.fn());
vi.mock('@/lib/agentteams-store', () => ({ useAgentTeamsStore: () => ({ sessionUser: state.username, userLevel: 3 }) }));
vi.mock('@/lib/matrix-store', () => ({ useMatrixStore: () => ({ userId: state.userId }) }));
vi.mock('@/hooks/use-chat-room-access', () => ({ useChatRoomAccess: () => ({ state: state.access, joinedRooms: state.rooms }) }));
vi.mock('@/lib/open-chat-room', () => ({ openChatRoom: openRoom }));
const team = { name: 'design', admin: { name: 'alice' }, leaderDMRoomID: '!private:test' } as TeamResponse;
beforeEach(() => { state.username = 'alice'; state.userId = '@alice:test'; state.access = 'joined'; state.rooms = ['!private:test']; openRoom.mockClear(); });
afterEach(cleanup);

describe('Team assistant entry', () => {
  it('opens the existing private room only after an explicit owner action', () => {
    render(<TeamAssistantButton team={team} />);
    const button = screen.getByRole('button', { name: '团队助手' });
    expect(screen.queryByText('!private:test')).not.toBeInTheDocument();
    fireEvent.pointerEnter(button, { pointerType: 'mouse' });
    expect(openRoom).not.toHaveBeenCalled();
    fireEvent.click(button);
    expect(openRoom).toHaveBeenCalledWith('!private:test');
  });

  it('does not grant the entry to another platform administrator or ordinary member', () => {
    state.username = 'admin'; state.userId = '@admin:test';
    render(<TeamAssistantButton team={team} />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it.each(['checking', 'disconnected', 'error', 'joined'])('keeps the entry disabled when membership is not confirmed: %s', (access) => {
    state.access = access; state.rooms = [];
    render(<TeamAssistantButton team={team} />);
    const button = screen.getByRole('button', { name: '团队助手' });
    expect(button).toBeDisabled();
    fireEvent.click(button);
    expect(openRoom).not.toHaveBeenCalled();
  });
});
