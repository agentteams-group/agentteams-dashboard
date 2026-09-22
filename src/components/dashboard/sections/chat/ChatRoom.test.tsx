import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
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
  // Per-test overrides (member list / session dots).
  const roomMembersChunk: unknown[] = [];
  let agentStatusMap: Record<string, unknown> = {};
  return {
    sendReceiptMutate,
    setReadMarkerMutate,
    sendMutate,
    virtuoso,
    roomMembersChunk,
    getAgentStatusMap: () => agentStatusMap,
    setAgentStatusMap: (v: Record<string, unknown>) => {
      agentStatusMap = v;
    },
  };
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
    useMatrixRoomMembers: () => ({ data: { chunk: mocks.roomMembersChunk }, isSuccess: true }),
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

vi.mock('@/hooks/use-worker-session-state', () => ({
  // These hooks hit react-query (worker list) / matrix stores which the
  // render harness below does not wrap in providers — mock all exports.
  useWorkerAgentStatusMap: () => mocks.getAgentStatusMap(),
  useSessionTick: () => 0,
  useChatRoomSessionState: () => ({ state: 'idle', runningOnly: false }),
}));

vi.mock('framer-motion', () => ({
  motion: { div: forwardRef((props: Record<string, unknown>, ref: ForwardedRef<HTMLDivElement>) => <div ref={ref} {...props} />) },
  AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
}));

vi.mock('@/components/dashboard/sections/chat/markdown-message', () => ({
  MarkdownMessage: ({ content }: { content: string }) => <div>{content}</div>,
}));

function renderChatRoom(props: Partial<Parameters<typeof ChatRoom>[0]> = {}) {
  return render(
    <ChatProvider>
      <ChatRoom roomId="!room:test" roomName="测试房间" {...props} />
    </ChatProvider>
  );
}

describe('ChatRoom read-position dual-write', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.roomMembersChunk.length = 0;
    mocks.setAgentStatusMap({});
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

  it('shows phase and runtime badges in the header', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true, homeserver: 'https://hs.test', accessToken: 'tok' });
    renderChatRoom({ roomPhase: 'Running', roomRuntime: 'qwenpaw' });
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('QwenPaw')).toBeInTheDocument();
  });

  it('shows the session dot on worker avatars (and only workers) in the member list', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true, homeserver: 'https://hs.test', accessToken: 'tok' });
    mocks.setAgentStatusMap({ '@w1:test': { agentStatus: 'running' } });
    mocks.roomMembersChunk.push(
      {
        type: 'm.room.member',
        state_key: '@w1:test',
        content: { membership: 'join', displayname: 'Worker One' },
      },
      {
        type: 'm.room.member',
        state_key: '@h1:test',
        content: { membership: 'join', displayname: 'Human One' },
      }
    );

    renderChatRoom();
    fireEvent.click(screen.getByTitle('显示成员'));

    const rows = screen.getAllByTitle('点击复制用户ID');
    const workerRow = rows.find((r) => r.textContent?.includes('Worker One'));
    const humanRow = rows.find((r) => r.textContent?.includes('Human One'));
    expect(workerRow).toBeTruthy();
    // Worker row: heartbeat says running → blue dot with the 运行中 label.
    expect(within(workerRow as HTMLElement).getByLabelText('运行中')).toBeInTheDocument();
    // Human row: no worker mapping → no dot at all.
    expect(within(humanRow as HTMLElement).queryByLabelText(/运行中|已完成|空闲/)).toBeNull();
  });

  it('Stopped phase forces the worker dot to idle even with a running heartbeat', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true, homeserver: 'https://hs.test', accessToken: 'tok' });
    mocks.setAgentStatusMap({ '@w1:test': { agentStatus: 'running', runningTaskCount: 1, phase: 'Stopped' } });
    mocks.roomMembersChunk.push({
      type: 'm.room.member',
      state_key: '@w1:test',
      content: { membership: 'join', displayname: 'Worker One' },
    });

    renderChatRoom();
    fireEvent.click(screen.getByTitle('显示成员'));

    const rows = screen.getAllByTitle('点击复制用户ID');
    const workerRow = rows.find((r) => r.textContent?.includes('Worker One'));
    expect(workerRow).toBeTruthy();
    // Stopped container phase overrides the stale running heartbeat → idle dot.
    expect(within(workerRow as HTMLElement).getByLabelText('空闲')).toBeInTheDocument();
    expect(within(workerRow as HTMLElement).queryByLabelText('运行中')).toBeNull();
  });
});
