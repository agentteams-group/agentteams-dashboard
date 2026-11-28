import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AssistantRoomList } from './assistant-room-list';
import type { RoomInfo } from './room-info';

afterEach(cleanup);
describe('Assistant private room picker', () => {
  it('separates AT and team assistants and requires confirmed room membership', () => {
    const choose = vi.fn();
    const rooms: RoomInfo[] = [
      { id: '!ops:test', name: 'AgentTeams助手', type: 'manager', agentRole: 'operations', members: [], access: 'joined' },
      { id: '!leader:test', name: '设计团队助手', type: 'manager', agentRole: 'leader', members: [], access: 'not-joined' },
      { id: '!group:test', name: '设计团队群聊', type: 'team', members: [], access: 'joined' },
    ];
    render(<AssistantRoomList rooms={rooms} selectedRoomId="!ops:test" onSelectRoom={choose} />);
    const at = within(screen.getByRole('region', { name: 'AgentTeams助手' })).getByRole('button', { name: 'AgentTeams助手' });
    fireEvent.pointerEnter(at, { pointerType: 'mouse' });
    expect(choose).not.toHaveBeenCalled();
    fireEvent.click(at);
    expect(choose).toHaveBeenCalledWith('!ops:test');
    expect(screen.getByRole('button', { name: /设计团队助手/ })).toBeDisabled();
    expect(screen.getByText('尚未加入私聊，请联系团队管理员')).toBeInTheDocument();
    expect(screen.queryByText('设计团队群聊')).not.toBeInTheDocument();
  });

  it('explains unavailable assistant types without exposing private room identifiers', () => {
    render(<AssistantRoomList rooms={[]} selectedRoomId={null} onSelectRoom={vi.fn()} />);
    expect(screen.getByText('当前账号没有可用的 AgentTeams助手私聊。')).toBeInTheDocument();
    expect(screen.getByText('团队助手仅对你担任 Team Admin 的团队开放。')).toBeInTheDocument();
  });
});
