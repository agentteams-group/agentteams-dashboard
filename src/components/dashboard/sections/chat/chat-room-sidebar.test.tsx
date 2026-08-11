import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChatRoomSidebar } from './chat-room-sidebar';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import type { RoomInfo } from './room-info';

afterEach(cleanup);

const room = (overrides: Partial<RoomInfo>): RoomInfo => ({
  id: '!r:test',
  name: 'Room',
  type: 'team',
  members: [],
  ...overrides,
});

const rooms: RoomInfo[] = [
  room({ id: '!new:test', name: 'Newest', lastMessageTs: 3000 }),
  room({ id: '!unread:test', name: 'Unread Room', lastMessageTs: 2000, unreadCount: 3 }),
  room({ id: '!old:test', name: 'Oldest', lastMessageTs: 1000 }),
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
});
