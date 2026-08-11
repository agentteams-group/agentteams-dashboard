import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { forwardRef, useImperativeHandle } from 'react';
import type { ForwardedRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatProvider } from './ChatStore';
import { ChatRoom } from './ChatRoom';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { useMatrixStore } from '@/lib/matrix-store';

const mocks = vi.hoisted(() => {
  const sendReceiptMutate = vi.fn();
  const setReadMarkerMutate = vi.fn();
  const sendMutate = vi.fn();
  const virtuoso = {
    scrollToIndex: vi.fn(),
    props: null as Record<string, unknown> | null,
  };
  return { sendReceiptMutate, setReadMarkerMutate, sendMutate, virtuoso };
});

vi.mock('react-virtuoso', () => ({
  Virtuoso: forwardRef(function VirtuosoMock(
    props: Record<string, unknown>,
    ref: ForwardedRef<{ scrollToIndex: typeof mocks.virtuoso.scrollToIndex }>
  ) {
    mocks.virtuoso.props = props;
    useImperativeHandle(ref, () => ({ scrollToIndex: mocks.virtuoso.scrollToIndex }));
    const data = props.data as { message: { content: string } }[];
    const itemContent = props.itemContent as (_index: number, _item: unknown) => React.ReactNode;
    return (
      <div data-testid="virtuoso">
        {data.map((item, index) => itemContent(index, item))}
      </div>
    );
  }),
}));

vi.mock('@/hooks/use-matrix', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-matrix')>();
  return {
    ...actual,
    useMatrixRoomMessages: () => ({
      isSuccess: true,
      data: {
        pages: [
          {
            chunk: [
              {
                event_id: '$old',
                sender: '@peer:test',
                type: 'm.room.message',
                origin_server_ts: 1000,
                content: { msgtype: 'm.text', body: '第一条' },
              },
              {
                event_id: '$new',
                sender: '@peer:test',
                type: 'm.room.message',
                origin_server_ts: 2000,
                content: { msgtype: 'm.text', body: '第二条' },
              },
            ],
          },
        ],
      },
      hasNextPage: false,
      isFetchingNextPage: false,
      isLoading: false,
      fetchNextPage: vi.fn(),
    }),
    useMatrixRoomMembers: () => ({ data: { chunk: [] }, isSuccess: true }),
    useMatrixRoomState: () => ({ data: null }),
    useMatrixReadMarker: () => ({ data: { event_id: '$old' }, isSuccess: true, isError: false }),
    useMatrixReadReceipts: () => ({}),
    useMatrixSetReadMarker: () => ({ mutate: mocks.setReadMarkerMutate, isPending: false }),
    useMatrixSendReadReceipt: () => ({ mutate: mocks.sendReceiptMutate }),
    useMatrixSendMessage: () => ({ mutate: mocks.sendMutate, isPending: false, error: null }),
    useMatrixEditMessage: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
    useMatrixRedactMessage: () => ({ mutate: vi.fn() }),
    useMatrixUploadMedia: () => ({ mutate: vi.fn(), isPending: false }),
    useTypingNotification: () => ({ notifyTyping: vi.fn(), stopTyping: vi.fn() }),
    useMatrixTypingUsers: () => [],
  };
});

vi.mock('framer-motion', () => ({
  motion: { div: forwardRef((props: Record<string, unknown>, ref: ForwardedRef<HTMLDivElement>) => <div ref={ref} {...props} />) },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/dashboard/sections/chat/markdown-message', () => ({
  MarkdownMessage: ({ content }: { content: string }) => <div>{content}</div>,
}));

function renderChatRoom() {
  return render(
    <ChatProvider>
      <ChatRoom roomId="!room:test" roomName="测试房间" />
    </ChatProvider>
  );
}

describe('ChatRoom read-position dual-write', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it('writes both m.read and m.fully_read when the user reaches the bottom', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true, homeserver: 'https://hs.test', accessToken: 'tok' });
    useRoomMetaStore.setState({
      meta: { '!room:test': { unreadCount: 2, updatedAt: 1 } },
      activeRoomId: '!room:test',
    });

    renderChatRoom();

    const props = mocks.virtuoso.props as { atBottomStateChange: (_atBottom: boolean) => void };
    act(() => props.atBottomStateChange(true));

    // Optimistic clear of the sidebar badge.
    expect(useRoomMetaStore.getState().meta['!room:test'].unreadCount).toBe(0);
    // Both writes target the latest message.
    expect(mocks.sendReceiptMutate).toHaveBeenCalledWith({ roomId: '!room:test', eventId: '$new' });
    expect(mocks.setReadMarkerMutate).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: '!room:test', eventId: '$new' }),
      expect.anything()
    );
  });

  it('still writes m.fully_read when the m.read receipt fails', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true, homeserver: 'https://hs.test', accessToken: 'tok' });
    mocks.sendReceiptMutate.mockImplementation(() => Promise.reject(new Error('network down')));

    renderChatRoom();

    const props = mocks.virtuoso.props as { atBottomStateChange: (_atBottom: boolean) => void };
    act(() => props.atBottomStateChange(true));

    expect(mocks.setReadMarkerMutate).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: '!room:test', eventId: '$new' }),
      expect.anything()
    );
  });

  it('advances the read position to the sent message after a successful send', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true, homeserver: 'https://hs.test', accessToken: 'tok' });
    useRoomMetaStore.setState({
      meta: { '!room:test': { unreadCount: 2, updatedAt: 1 } },
      activeRoomId: '!room:test',
    });
    mocks.sendMutate.mockImplementation((_vars: unknown, handlers?: { onSuccess?: (_data: { event_id: string }) => void }) => {
      handlers?.onSuccess?.({ event_id: '$sent' });
    });

    renderChatRoom();

    const composer = screen.getByPlaceholderText(/发送消息到 测试房间/);
    fireEvent.change(composer, { target: { value: '你好' } });
    fireEvent.keyDown(composer, { key: 'Enter', shiftKey: false });

    expect(mocks.sendReceiptMutate).toHaveBeenCalledWith({ roomId: '!room:test', eventId: '$sent' });
    expect(mocks.setReadMarkerMutate).toHaveBeenCalledWith(
      expect.objectContaining({ roomId: '!room:test', eventId: '$sent' }),
      expect.anything()
    );
  });
});
