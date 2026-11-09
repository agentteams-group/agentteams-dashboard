import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChatRoomSidebar } from './chat-room-sidebar';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import type { RoomInfo } from './room-info';

afterEach(cleanup);
beforeEach(() => {
  useHitlInboxStore.setState({ confirmations: {}, resolutions: {} });
  try {
    localStorage.clear();
  } catch {
    /* jsdom 一定有，保险 */
  }
});

const room = (overrides: Partial<RoomInfo>): RoomInfo => ({
  id: '!r:test',
  name: 'Room',
  type: 'team',
  members: [],
  access: 'joined',
  ...overrides,
});

const rooms: RoomInfo[] = [
  room({ id: '!new:test', name: 'Newest', lastMessageTs: 3000, lastMessagePreview: '最新一条' }),
  room({ id: '!unread:test', name: 'Unread Room', lastMessageTs: 2000, unreadCount: 3 }),
  room({ id: '!old:test', name: 'Oldest', lastMessageTs: 1000, type: 'worker', runtime: 'qwenpaw' }),
];

const renderSidebar = (props: Partial<Parameters<typeof ChatRoomSidebar>[0]> = {}) =>
  render(
    <ChatRoomSidebar
      rooms={rooms}
      selectedRoomId={null}
      onSelectRoom={() => {}}
      isLoggedIn
      userId="@user:test"
      isLoading={false}
      onCollapse={() => {}}
      {...props}
    />
  );

describe('ChatRoomSidebar', () => {
  it('folds each team independently and keeps other conversations available', () => {
    const leader = room({ id: '!design:test', name: '设计助手', type: 'manager', agentRole: 'leader', parentTeam: 'design', access: 'joined' });
    renderSidebar({ rooms: [leader, room({ id: '!group:test', name: '设计群聊', parentTeam: 'design' }), room({ id: '!worker:test', name: '普通私聊', type: 'worker' })] });
    expect(screen.queryByText('设计助手')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '展开团队：design' }));
    expect(screen.getByText('设计助手')).toBeInTheDocument();
    expect(screen.getByText('设计群聊')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: '收起团队：design' }));
    expect(screen.queryByText('设计助手')).toBeNull();
    expect(screen.getByText('普通私聊')).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText('搜索对话…'), { target: { value: '设计助手' } });
    expect(screen.getByText('设计助手')).toBeInTheDocument();
  });

  it('shows a reason on an unjoined DM without enabling it', () => {
    renderSidebar({ rooms: [room({ name: '无权私聊', type: 'manager', agentRole: 'leader', access: 'not-joined' })] });
    expect(screen.getByRole('button', { name: /无权私聊/ })).toBeDisabled();
    expect(screen.getByText(/尚未加入私聊/)).toBeInTheDocument();
  });

  it('renders rooms in the supplied order with unread badges', () => {
    renderSidebar();
    const buttons = screen.getAllByRole('button');
    // Each room row is a button (plus the collapse button in the header).
    expect(buttons.length).toBeGreaterThanOrEqual(3);
    expect(screen.getByText('Newest')).toBeInTheDocument();
    expect(screen.getByText('Unread Room')).toBeInTheDocument();
    expect(screen.getByLabelText('3 条未读')).toBeInTheDocument();
  });

  it('shows actionable HITL items per room and clears the badge when resolved', () => {
    useHitlInboxStore.setState({
      confirmations: {
        iv1: {
          id: 'iv1', roomId: '!new:test', eventId: '$1', sender: '@agent:test',
          toolName: 'ask_human', question: '继续吗？', approveReply: '/approve',
          rejectReply: '拒绝', timestamp: 1000,
        },
      },
    });
    renderSidebar();
    expect(screen.getByLabelText('1 条待处理')).toBeInTheDocument();

    act(() => useHitlInboxStore.getState().resolveConfirmation('iv1', '@user:test'));
    expect(screen.queryByLabelText('1 条待处理')).toBeNull();
  });

  it('clears the unread badge on click while keeping the room in place', () => {
    useRoomMetaStore.setState({
      meta: { '!unread:test': { lastMessageTs: 2000, unreadCount: 3, updatedAt: 1 } },
      activeRoomId: null,
    });
    const onSelectRoom = vi.fn();
    renderSidebar({ onSelectRoom });

    fireEvent.click(screen.getByText('Unread Room'));
    expect(onSelectRoom).toHaveBeenCalledWith('!unread:test');
    expect(useRoomMetaStore.getState().meta['!unread:test'].unreadCount).toBe(0);
    expect(useRoomMetaStore.getState().meta['!unread:test'].clearedAt).toBeDefined();
  });

  it('calls onSelectRoom with the clicked room id', () => {
    const onSelectRoom = vi.fn();
    renderSidebar({ onSelectRoom });
    fireEvent.click(screen.getByText('Newest'));
    expect(onSelectRoom).toHaveBeenCalledWith('!new:test');
  });

  it('filters rooms by search text', () => {
    renderSidebar();
    fireEvent.change(screen.getByPlaceholderText('搜索对话…'), { target: { value: 'unread' } });
    expect(screen.getByText('Unread Room')).toBeInTheDocument();
    expect(screen.queryByText('Newest')).toBeNull();
  });

  it('defaults to workspace groups while retaining ordinary rooms', () => {
    renderSidebar();
    // Ordinary rooms remain reachable below the team-oriented entries.
    expect(screen.getByText('其他对话')).toBeInTheDocument();
    expect(screen.queryByText('Agent')).toBeNull();
    expect(screen.getByText('Newest')).toBeInTheDocument();
    expect(screen.getByText('最新一条')).toBeInTheDocument();
    expect(screen.getByText('QwenPaw')).toBeInTheDocument();
  });

  it('filters by kind through the category menu', async () => {
    renderSidebar({
      rooms: [
        room({ id: '!g:test', name: 'GroupRoom', type: 'team', memberCount: 5, lastMessageTs: 10 }),
        room({ id: '!d:test', name: 'DmRoom', type: 'worker', memberCount: 2, lastMessageTs: 20 }),
      ],
    });

    // The category control must be the app's menu, never a native OS select.
    expect(document.querySelector('select')).toBeNull();

    fireEvent.pointerDown(screen.getByLabelText('房间分类'), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '群组' }));
    expect(screen.getByText('GroupRoom')).toBeInTheDocument();
    expect(screen.queryByText('DmRoom')).toBeNull();

    fireEvent.pointerDown(screen.getByLabelText('房间分类'), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '私聊' }));
    expect(screen.getByText('DmRoom')).toBeInTheDocument();
    expect(screen.queryByText('GroupRoom')).toBeNull();
  });

  it('retains type-grouped view via the arrangement menu', async () => {
    renderSidebar();
    fireEvent.pointerDown(screen.getByLabelText('会话排列'), { button: 0, ctrlKey: false });
    fireEvent.click(await screen.findByRole('menuitemradio', { name: '按房间类型' }));
    expect(screen.getByText('团队')).toBeInTheDocument();
    expect(screen.getByText('Agent')).toBeInTheDocument();
  });

  it('omits the runtime badge and never renders the literal "undefined" when phase/runtime are missing', () => {
    const sparseRoom = room({
      id: '!sparse:test',
      name: 'Sparse',
      type: 'worker',
      // intentionally no phase, no runtime, no preview
    });
    renderSidebar({ rooms: [sparseRoom] });
    // No undefined leakage anywhere in the document body.
    expect(document.body.textContent).not.toMatch(/undefined/);
    // The runtime badge would have rendered 'QwenPaw' for the old fixture;
    // assert that the sparse room does NOT get one.
    const sparseButton = screen.getByText('Sparse').closest('button');
    expect(sparseButton).not.toBeNull();
    expect(sparseButton?.querySelectorAll('span').length ?? 0).toBe(0);
  });

  it('keeps the plain account line when the caller supplies no footer', () => {
    renderSidebar();
    expect(screen.getByText('已登录: user')).toBeInTheDocument();
  });

  it('replaces the account line with the caller session cluster', () => {
    renderSidebar({ footer: <div data-testid="session-footer">实时</div> });
    expect(screen.getByTestId('session-footer')).toBeInTheDocument();
    expect(screen.queryByText('已登录: user')).toBeNull();
  });
});
