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
    fireEvent.change(screen.getByPlaceholderText('搜索房间...'), { target: { value: 'unread' } });
    expect(screen.getByText('Unread Room')).toBeInTheDocument();
    expect(screen.queryByText('Newest')).toBeNull();
  });

  it('defaults to a flat recency list (Element/plugin-style) without group headers', () => {
    renderSidebar();
    // 默认「按时间」：不出现类型分组头，房间直接并列。
    expect(screen.queryByText('团队')).toBeNull();
    expect(screen.queryByText('Agent')).toBeNull();
    expect(screen.getByText('Newest')).toBeInTheDocument();
    expect(screen.getByText('最新一条')).toBeInTheDocument();
    expect(screen.getByText('QwenPaw')).toBeInTheDocument();
  });

  it('filters by kind: 群组 / 私聊 chips', () => {
    renderSidebar({
      rooms: [
        room({ id: '!g:test', name: 'GroupRoom', type: 'team', memberCount: 5, lastMessageTs: 10 }),
        room({ id: '!d:test', name: 'DmRoom', type: 'worker', memberCount: 2, lastMessageTs: 20 }),
      ],
    });
    fireEvent.change(screen.getByLabelText('房间分类'), { target: { value: 'group' } });
    expect(screen.getByText('GroupRoom')).toBeInTheDocument();
    expect(screen.queryByText('DmRoom')).toBeNull();
    fireEvent.change(screen.getByLabelText('房间分类'), { target: { value: 'dm' } });
    expect(screen.getByText('DmRoom')).toBeInTheDocument();
    expect(screen.queryByText('GroupRoom')).toBeNull();
  });

  it('switches to type-grouped view via the toggle', () => {
    renderSidebar();
    fireEvent.click(screen.getByLabelText('当前按时间排序，切换为按类型分组'));
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
});
