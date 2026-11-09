import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationSwitcher } from './conversation-switcher';
import type { RoomInfo } from './room-info';

afterEach(cleanup);
const leader = (team: string): RoomInfo => ({ id: `!${team}:test`, name: `${team}助手`, type: 'manager', agentRole: 'leader', parentTeam: team, members: [], access: 'joined' });

describe('team switcher', () => {
  it('opens the team collaboration room directly and returns to the assistant', () => {
    const assistant = leader('design');
    const group: RoomInfo = { id: '!design-group:test', name: 'design团队房间', type: 'team', parentTeam: 'design', members: [] };
    const onSelectRoom = vi.fn();
    const { rerender } = render(<ConversationSwitcher rooms={[assistant, group]} selectedRoomId={assistant.id} attention={{}} onSelectRoom={onSelectRoom} />);
    fireEvent.click(screen.getByRole('button', { name: '团队协作' }));
    expect(onSelectRoom).toHaveBeenLastCalledWith(group.id);
    rerender(<ConversationSwitcher rooms={[assistant, group]} selectedRoomId={group.id} attention={{}} onSelectRoom={onSelectRoom} />);
    fireEvent.click(screen.getByRole('button', { name: '团队助手' }));
    expect(onSelectRoom).toHaveBeenLastCalledWith(assistant.id);
  });

  it('does not offer an unjoined assistant from the team room', () => {
    const group: RoomInfo = { id: '!design-group:test', name: 'design群聊', type: 'team', parentTeam: 'design', members: [] };
    render(<ConversationSwitcher rooms={[{ ...leader('design'), access: 'not-joined' }, group]} selectedRoomId={group.id} attention={{}} onSelectRoom={vi.fn()} />);
    expect(screen.queryByRole('button', { name: '团队助手' })).toBeNull();
  });
  it('shows a single team without an unnecessary menu', () => {
    const room = leader('design');
    render(<ConversationSwitcher rooms={[room]} selectedRoomId={room.id} attention={{}} onSelectRoom={vi.fn()} />);
    expect(screen.getByText('design')).toBeInTheDocument();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('switches between teams and distinguishes task attention from unread messages', async () => {
    const design = leader('design'), dev = leader('dev'), onSelectRoom = vi.fn();
    render(<ConversationSwitcher rooms={[design, { ...dev, unreadCount: 20 }]} selectedRoomId={design.id} attention={{ [dev.id]: { confirmation: 1, review: 2, failed: 3 } }} onSelectRoom={onSelectRoom} />);
    expect(screen.getByLabelText('其他团队 6 项待处理')).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: '切换团队，当前：design' }), { button: 0, ctrlKey: false });
    const item = await screen.findByRole('menuitemradio', { name: /dev/ });
    for (const text of ['待确认 1', '待验收 2', '失败 3']) expect(within(item).getByText(text)).toBeInTheDocument();
    expect(within(item).queryByText('20')).toBeNull();
    fireEvent.click(item);
    expect(onSelectRoom).toHaveBeenCalledWith(dev.id);
  });

  it('falls back to a team group instead of opening an unjoined Leader DM', async () => {
    const blocked = { ...leader('dev'), access: 'not-joined' as const };
    const group: RoomInfo = { id: '!dev-group:test', name: 'dev群聊', type: 'team', parentTeam: 'dev', members: [] };
    const onSelectRoom = vi.fn();
    render(<ConversationSwitcher rooms={[leader('design'), blocked, group]} selectedRoomId={null} attention={{}} onSelectRoom={onSelectRoom} />);
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: 'dev' }));
    expect(onSelectRoom).toHaveBeenCalledWith(group.id);
  });

  it('disables a team with no accessible conversation and explains why', async () => {
    const onSelectRoom = vi.fn();
    render(<ConversationSwitcher rooms={[leader('design'), { ...leader('dev'), access: 'not-joined' }]} selectedRoomId={null} attention={{}} onSelectRoom={onSelectRoom} />);
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0, ctrlKey: false });
    const item = await screen.findByRole('menuitemradio', { name: /dev.*尚未加入私聊/ });
    expect(item).toHaveAttribute('data-disabled');
    fireEvent.click(item);
    expect(onSelectRoom).not.toHaveBeenCalled();
  });

  it('reports unavailable task data instead of showing stale counts as current', async () => {
    render(<ConversationSwitcher rooms={[leader('design'), leader('dev')]} selectedRoomId={null} attention={{ '!dev:test': { confirmation: 1, review: 2, failed: 3 } }} pending="任务数据待更新" onSelectRoom={vi.fn()} />);
    fireEvent.pointerDown(screen.getByRole('button'), { button: 0, ctrlKey: false });
    expect(await screen.findAllByText('任务数据待更新')).toHaveLength(2);
    expect(screen.queryByText('待验收 2')).toBeNull();
  });
});
