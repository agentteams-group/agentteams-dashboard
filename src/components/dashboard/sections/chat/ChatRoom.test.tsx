import { act, cleanup, fireEvent, render, screen, within, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Fragment, forwardRef, useImperativeHandle } from 'react';
import type { ForwardedRef } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { RuntimeMapProvider } from './runtime-map-context';
import { ChatProvider } from './ChatStore';
import {
  ChatRoom,
  resetRoomSearchDeepLinkForTests,
  takeRoomSearchDeepLink,
} from './ChatRoom';
import { roomHash } from '@/lib/nav-hash';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { useMatrixStore } from '@/lib/matrix-store';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useSectionStore } from '@/lib/section-store';
import { RUNTIME_APPROVAL_KEY } from '@/lib/runtime-approval';
import { matrixApi, MatrixRequestError, type MatrixEvent } from '@/lib/matrix-api';
import { useChatMessageQueue } from '@/lib/chat-message-queue';
import { useAgentTeamsStore } from '@/lib/agentteams-store';

const mocks = vi.hoisted(() => {
  const sendReceiptMutate = vi.fn();
  const setReadMarkerMutate = vi.fn();
  const sendMutate = vi.fn();
  const sendMutateAsync = vi.fn().mockResolvedValue({ event_id: '$queued-send' });
  const olderMessages = { hasNextPage: false, fetchNextPage: vi.fn() };
  const uploadMutateAsync = vi.fn().mockResolvedValue({ content_uri: 'mxc://hs.test/file' });
  const roomMessagesChunk: unknown[] = [
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
  ];
  const virtuoso = {
    scrollToIndex: vi.fn(),
    props: null as Record<string, unknown> | null,
  };
  // Per-test overrides (member list / session dots).
  const roomMembersChunk: unknown[] = [];
  const threadMessagesChunk: MatrixEvent[] = [];
  let agentStatusMap: Record<string, unknown> = {};
  return {
    sendReceiptMutate,
    setReadMarkerMutate,
    sendMutate,
    sendMutateAsync,
    olderMessages,
    uploadMutateAsync,
    roomMessagesChunk,
    roomMessagesData: { pages: [{ chunk: roomMessagesChunk }] },
    virtuoso,
    roomMembersChunk,
    threadMessagesChunk,
    roomState: { data: null as null | { type: string; state_key: string; content: { membership: string } }[] },
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
    const data = props.data as { id?: string; content: string }[];
    const itemContent = props.itemContent as (_index: number, _item: unknown) => React.ReactNode;
    return (
      <div data-testid="virtuoso">
        {data.map((item, index) => <Fragment key={item.id ?? index}>{itemContent(index, item)}</Fragment>)}
      </div>
    );
  }),
}));

vi.mock('./chat-room-lazy-panels', async () => {
  const [messages, composer, context, workers, attachments, topology, roomAttachments] = await Promise.all([
    import('./structures/MessageList'),
    import('./chat-composer'),
    import('./components/RoomContextPanel'),
    import('@/components/dashboard/sections/workers/worker-chats-panel'),
    import('./attachment-preview'),
    import('./components/TaskTopologyPopover'),
    import('./components/RoomAttachments'),
  ]);
  return {
    MessageList: messages.MessageList,
    ChatComposer: composer.ChatComposer,
    RoomContextPanel: context.RoomContextPanel,
    WorkerChatsPanel: workers.WorkerChatsPanel,
    AttachmentPreviewPanel: attachments.AttachmentPreviewPanel,
    TaskTopologyPopover: topology.TaskTopologyPopover,
    RoomAttachments: roomAttachments.RoomAttachments,
  };
});

vi.mock('@/hooks/use-matrix', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-matrix')>();
  return {
    ...actual,
    useMatrixRoomMessages: () => ({
      isSuccess: true,
      data: mocks.roomMessagesData,
      hasNextPage: mocks.olderMessages.hasNextPage,
      isFetchingNextPage: false,
      isLoading: false,
      fetchNextPage: mocks.olderMessages.fetchNextPage,
    }),
    useMatrixRoomMembers: () => ({ data: { chunk: mocks.roomMembersChunk }, isSuccess: true }),
    useMatrixRoomState: () => mocks.roomState,
    useMatrixReadMarker: () => ({ data: { event_id: '$old' }, isSuccess: true, isError: false }),
    useMatrixReadReceipts: () => ({}),
    useMatrixThreadMessages: () => ({ data: { chunk: mocks.threadMessagesChunk }, isLoading: false, isError: false }),
    useMatrixSetReadMarker: () => ({ mutate: mocks.setReadMarkerMutate, isPending: false }),
    useMatrixSendReadReceipt: () => ({ mutate: mocks.sendReceiptMutate }),
    useMatrixSendMessage: () => ({ mutate: mocks.sendMutate, mutateAsync: mocks.sendMutateAsync, isPending: false, error: null }),
    useMatrixEditMessage: () => ({ mutate: vi.fn(), mutateAsync: vi.fn() }),
    useMatrixRedactMessage: () => ({ mutate: vi.fn() }),
    useMatrixUploadMedia: () => ({ mutate: vi.fn(), mutateAsync: mocks.uploadMutateAsync, isPending: false }),
    useTypingNotification: () => ({ notifyTyping: vi.fn(), stopTyping: vi.fn() }),
    useMatrixTypingUsers: () => [],
  };
});

vi.mock('@/hooks/use-thread-replies', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/use-thread-replies')>();
  return {
    ...actual,
    useThreadReplies: () => ({
      data: { pages: [{ chunk: mocks.threadMessagesChunk, next_batch: '' }] },
      isLoading: false,
      isError: false,
    }),
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

function renderChatRoom(props: Partial<Parameters<typeof ChatRoom>[0]> = {}, runtimeMap?: Parameters<typeof RuntimeMapProvider>[0]['map']) {
  const queryClient = new QueryClient();
  return render(
    <ChatProvider>
      <ChatRoom roomId="!room:test" roomName="测试房间" {...props} />
    </ChatProvider>,
    { wrapper: ({ children }) => <QueryClientProvider client={queryClient}><TooltipProvider><RuntimeMapProvider map={runtimeMap ?? {}}>{children}</RuntimeMapProvider></TooltipProvider></QueryClientProvider> },
  );
}

describe('ChatRoom read-position dual-write', () => {
  it('quotes a specific message when composing and sending a reply', async () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true });
    renderChatRoom();
    const original = (await screen.findByText('第一条')).closest<HTMLElement>('[data-chat-message]')!;
    fireEvent.mouseEnter(original.querySelector('[data-chat-message-body]')!);
    fireEvent.click(within(original).getByRole('button', { name: '回复' }));
    expect(screen.getByText('回复给：peer')).toBeInTheDocument();
    const input = screen.getByRole('textbox');
    expect(input).toHaveFocus();
    fireEvent.click(screen.getByRole('button', { name: '取消引用回复' }));
    expect(screen.queryByText('回复给：peer')).not.toBeInTheDocument();
    fireEvent.click(within(original).getByRole('button', { name: '回复' }));
    fireEvent.change(input, { target: { value: '针对第一条的回复' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(mocks.sendMutate).toHaveBeenCalledWith(expect.objectContaining({
      body: '针对第一条的回复',
      relatesTo: { 'm.in_reply_to': { event_id: '$old' } },
    }), expect.anything());
    expect(screen.getByText('回复给：peer')).toBeInTheDocument();
  });

  it('renders an edited historical reply with a quote that jumps to the original', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true });
    mocks.roomMessagesChunk.push(
      { event_id: '$reply', sender: '@me:test', type: 'm.room.message', origin_server_ts: 3000,
        content: { msgtype: 'm.text', body: '原来的回复', 'm.relates_to': { 'm.in_reply_to': { event_id: '$old' } } } },
      { event_id: '$edit', sender: '@me:test', type: 'm.room.message', origin_server_ts: 4000,
        content: { msgtype: 'm.text', body: '* 修改后的回复', 'm.relates_to': { rel_type: 'm.replace', event_id: '$reply' },
          'm.new_content': { msgtype: 'm.text', body: '修改后的回复' } } },
    );
    renderChatRoom();
    const reply = screen.getByText('修改后的回复').closest<HTMLElement>('[data-chat-message]')!;
    const quote = within(reply).getByRole('button', { name: /回复给：peer.*第一条/ });
    fireEvent.click(quote);
    expect(mocks.virtuoso.scrollToIndex).toHaveBeenCalledWith(expect.objectContaining({ index: 0, align: 'center' }));
  });

  it('lists nested quoted replies together under the original message as a topic', async () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true });
    const quoted = '这是一段很长的原文，时间线只展示开头的几个字，完整内容可以在浮层里阅读。';
    const originalEvent = mocks.roomMessagesChunk[0] as { content: { body: string } };
    originalEvent.content.body = quoted;
    vi.stubGlobal('ResizeObserver', class {
      observe() {}
      unobserve() {}
      disconnect() {}
    });
    mocks.roomMessagesChunk.push(
      { event_id: '$first', sender: '@me:test', type: 'm.room.message', origin_server_ts: 3000,
        content: { msgtype: 'm.text', body: '客服回复', 'm.relates_to': { 'm.in_reply_to': { event_id: '$old' } } } },
      { event_id: '$second', sender: '@peer:test', type: 'm.room.message', origin_server_ts: 4000,
        content: { msgtype: 'm.text', body: '继续跟进', 'm.relates_to': { 'm.in_reply_to': { event_id: '$first' } } } },
    );
    try {
      renderChatRoom();
      const reply = screen.getAllByText('客服回复').find(node => node.localName === 'div')!.closest<HTMLElement>('[data-chat-message]')!;
      const quote = within(reply).getByRole('button', { name: /回复给：peer/ });
      expect(quote).toHaveTextContent('…');
      expect(quote).not.toHaveTextContent('完整内容可以在浮层里阅读');
      fireEvent.focus(quote);
      expect(await screen.findByRole('tooltip')).toHaveTextContent(quoted);
      fireEvent.blur(quote);

      const original = screen.getByText(quoted).closest<HTMLElement>('[data-chat-message]')!;
      fireEvent.click(within(original).getByRole('button', { name: /2 条回复/ }));
      const panel = within(screen.getByRole('complementary'));
      expect(panel.getByText('客服回复', { selector: 'div' })).toBeInTheDocument();
      expect(panel.getByText('继续跟进')).toBeInTheDocument();
      expect(panel.getByText(quoted, { selector: 'div' })).toBeInTheDocument();
      fireEvent.click(panel.getByRole('button', { name: '返回话题列表' }));
      expect(panel.getByRole('button', { name: /2 条回复/ })).toBeInTheDocument();
    } finally {
      originalEvent.content.body = '第一条';
      vi.unstubAllGlobals();
    }
  });

  it('opens topics from message actions and groups Agent steps with their answers', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true });
    const agent = '@worker:test';
    const entry = (id: string, seconds: number, body: string, runId: string): MatrixEvent => ({
      event_id: id, origin_server_ts: seconds * 1000, sender: agent, type: 'm.room.message',
      content: { msgtype: 'm.text', body, 'org.agentteams.run_id': runId,
        'm.relates_to': { rel_type: 'm.thread', event_id: '$old' } },
    });
    mocks.threadMessagesChunk.push(
      entry('$step1', 3, 'Thinking:\n\n验证第一条', 'run1'),
      entry('$tool1', 4, 'Thinking:\n\n继续验证', 'run1'),
      entry('$answer1', 5, '第一次处理已完成', 'run1'),
      entry('$step2', 6, 'Thinking:\n\n验证第二条', ''),
      entry('$answer2', 7, '第二次处理已完成', ''),
    );
    renderChatRoom({}, { [agent]: { workerName: 'worker', runtime: 'qwenpaw' } });
    const original = screen.getByText('第一条').closest<HTMLElement>('[data-chat-message]')!;
    fireEvent.mouseEnter(original.querySelector('[data-chat-message-body]')!);
    fireEvent.click(within(original).getByRole('button', { name: '查看话题' }));
    const panel = within(screen.getByRole('complementary'));
    const first = panel.getByText('第一次处理已完成').closest<HTMLElement>('[data-chat-message]')!;
    const second = panel.getByText('第二次处理已完成').closest<HTMLElement>('[data-chat-message]')!;
    expect(panel.getAllByText('过程', { exact: true })).toHaveLength(2);
    expect(first).not.toBe(second);
    expect(within(first).getByText('思考 2')).toBeInTheDocument();
    expect(within(second).getByText('思考 1')).toBeInTheDocument();
  });

  it('opens and highlights the exact mentioned thread reply even when its root is outside loaded history', async () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true, homeserver: 'https://hs.test', accessToken: 'test' });
    useSectionStore.setState({ mentionRoomId: '!room:test' });
    const getEvent = vi.spyOn(matrixApi, 'getRoomEvent').mockResolvedValue({
      event_id: '$root', sender: '@peer:test', type: 'm.room.message', origin_server_ts: 500,
      content: { msgtype: 'm.text', body: 'Older thread root' },
    });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    mocks.roomMessagesChunk.push({ event_id: '$thread-mention', sender: '@peer:test', type: 'm.room.message', origin_server_ts: 3000,
      content: { msgtype: 'm.text', body: 'Mentioned thread reply', 'm.mentions': { user_ids: ['@me:test'] },
        'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } } });
    renderChatRoom();
    await waitFor(() => expect(useSectionStore.getState().mentionRoomId).toBeNull());
    expect(getEvent).toHaveBeenCalledWith('https://hs.test', 'test', '!room:test', '$root');
    expect(within(screen.getByRole('complementary')).getByText('Mentioned thread reply').closest('.ring-1')).toBeInTheDocument();
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'center' });
    expect(mocks.sendReceiptMutate).not.toHaveBeenCalled();
    getEvent.mockRestore();
  });
  it('lands on an actual mention rather than the read marker or latest unrelated message', async () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true });
    useSectionStore.setState({ mentionRoomId: '!room:test' });
    mocks.roomMessagesChunk.push(
      { event_id: '$mention', sender: '@peer:test', type: 'm.room.message', origin_server_ts: 3000, content: { msgtype: 'm.text', body: 'Please review this', 'm.mentions': { user_ids: ['@me:test'] } } },
      { event_id: '$other', sender: '@peer:test', type: 'm.room.message', origin_server_ts: 4000, content: { msgtype: 'm.text', body: 'Not your mention', 'm.mentions': { user_ids: ['@someone:test'] } } },
    );
    renderChatRoom();
    await waitFor(() => expect(useSectionStore.getState().mentionRoomId).toBeNull());
    expect(mocks.virtuoso.scrollToIndex).toHaveBeenLastCalledWith(expect.objectContaining({ index: 3, align: 'center' }));
    expect(mocks.sendReceiptMutate).not.toHaveBeenCalled();
    expect(screen.queryByText('@ 提到了你')).not.toBeInTheDocument();
  });
  it('targets Stop and supplementary input at the advertised execution', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true });
    mocks.roomMembersChunk.push(...['@me:test', '@peer:test'].map(id => ({
      type: 'm.room.member', state_key: id, content: { membership: 'join' },
    })));
    mocks.roomMessagesChunk.push({ event_id: '$status', sender: '@peer:test', type: 'm.room.message', origin_server_ts: 3000,
      content: { msgtype: 'm.notice', body: '正在工作', 'com.agentteams.execution': { run_id: '$run', status: 'running', capabilities: ['stop', 'steer'] } } });
    renderChatRoom({ workerMatrixUserIds: ['@peer:test'], roomRuntime: 'qwenpaw' });
    expect(screen.getByText('发送会打断当前会话')).toBeInTheDocument();
    expect(screen.queryByText('正在工作')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '停止执行' }));
    expect(mocks.sendMutate.mock.calls.at(-1)?.[0].extra['com.agentteams.control']).toEqual({ action: 'stop', run_id: '$run', agent_id: '@peer:test' });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '只看杭州' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(mocks.sendMutate.mock.calls.at(-1)?.[0].extra['com.agentteams.control']).toEqual({ action: 'steer', run_id: '$run', agent_id: '@peer:test' });
  });
  it('uses the saved Enter preference to queue input in the actual room composer', () => {
    useAgentTeamsStore.setState({ replyEnterAction: 'queue' });
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true });
    mocks.roomMembersChunk.push(...['@me:test', '@peer:test'].map(id => ({
      type: 'm.room.member', state_key: id, content: { membership: 'join' },
    })));
    mocks.roomMessagesChunk.push({ event_id: '$status', sender: '@peer:test', type: 'm.room.message', origin_server_ts: 3000,
      content: { 'com.agentteams.execution': { run_id: '$run', status: 'running', capabilities: ['stop', 'steer'] } } });
    renderChatRoom({ workerMatrixUserIds: ['@peer:test'], roomRuntime: 'codex' });
    expect(screen.queryByText('发送会打断当前会话')).toBeNull();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '下一轮核对退款' } });
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' });
    expect(screen.getByRole('button', { name: '1 条排队中' })).toBeInTheDocument();
    expect(mocks.sendMutate).not.toHaveBeenCalled();
  });
  it('keeps queued input out of Matrix until selected and steers the currently advertised run', async () => {
    useMatrixStore.setState({ userId: '@me:test', homeserver: 'https://queue.test', isLoggedIn: true });
    mocks.roomMembersChunk.push(...['@me:test', '@peer:test'].map(id => ({
      type: 'm.room.member', state_key: id, content: { membership: 'join' },
    })));
    mocks.roomMessagesChunk.push({ event_id: '$status', sender: '@peer:test', type: 'm.room.message', origin_server_ts: 3000,
      content: { 'com.agentteams.execution': { run_id: '$run', status: 'running', capabilities: ['stop', 'steer'] } } });
    const view = renderChatRoom({ workerMatrixUserIds: ['@peer:test'] });
    for (const content of ['原定下一步', '改查杭州', '删除这条']) {
      fireEvent.change(screen.getByRole('textbox'), { target: { value: content } });
      fireEvent.click(screen.getByRole('button', { name: '加入消息队列' }));
    }
    expect(screen.getByRole('textbox')).toHaveValue('');
    expect(mocks.sendMutate).not.toHaveBeenCalled();
    expect(mocks.sendMutateAsync).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '3 条排队中' }));
    fireEvent.click(screen.getByRole('button', { name: '删除第 3 条排队消息' }));
    mocks.roomMessagesChunk.push({ event_id: '$new-status', sender: '@peer:test', type: 'm.room.message', origin_server_ts: 4000,
      content: { 'com.agentteams.execution': { run_id: '$new-run', status: 'running', capabilities: ['stop', 'steer'] } } });
    // React Query publishes a new data object for a changed page. Keep the
    // reference stable between unrelated renders, but not across timeline updates.
    mocks.roomMessagesData = { pages: [{ chunk: [...mocks.roomMessagesChunk] }] };
    view.rerender(<ChatProvider><ChatRoom roomId="!room:test" roomName="测试房间" workerMatrixUserIds={['@peer:test']} /></ChatProvider>);
    fireEvent.click(screen.getByRole('button', { name: '发送第 2 条排队消息' }));
    await waitFor(() => expect(mocks.sendMutateAsync).toHaveBeenCalledWith(expect.objectContaining({
      body: '改查杭州', extra: { 'com.agentteams.control': { action: 'steer', run_id: '$new-run', agent_id: '@peer:test' } },
    })));
    await waitFor(() => expect(screen.getByRole('button', { name: '1 条排队中' })).toBeInTheDocument());
  });
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.roomMembersChunk.length = 0;
    mocks.threadMessagesChunk.length = 0;
    mocks.roomState.data = null;
    mocks.roomMessagesChunk.length = 2;
    mocks.roomMessagesData = { pages: [{ chunk: mocks.roomMessagesChunk }] };
    mocks.olderMessages.hasNextPage = false;
    mocks.setAgentStatusMap({});
    useSectionStore.setState({ mentionRoomId: null });
    useChatMessageQueue.setState({ queues: {} });
    useAgentTeamsStore.setState({ replyEnterAction: 'send', autoReconnect: false });
  });

  it('explains why a visible room cannot be used after the current user left', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true });
    mocks.roomState.data = [{ type: 'm.room.member', state_key: '@me:test', content: { membership: 'leave' } }];
    renderChatRoom();
    expect(screen.getByText('你尚未加入此房间。请让团队管理员将你添加为团队成员后再聊天。')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeDisabled();
  });

  it('addresses the Leader when a user sends an ordinary assistant message', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true });
    const onSendMessage = vi.fn();
    renderChatRoom({ agentRole: 'leader', workerMatrixUserIds: ['@leader:test'], onSendMessage });
    fireEvent.change(screen.getByRole('textbox'), { target: { value: '你好' } });
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(onSendMessage).toHaveBeenCalledWith('@leader 你好', undefined, [expect.objectContaining({ userId: '@leader:test' })]);
  });

  it('keeps history readable while a room is read only, then restores its composer', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true });
    const onSendMessage = vi.fn();
    const view = renderChatRoom({ canSend: false, onSendMessage });
    expect(screen.getByText('第一条')).toBeInTheDocument();
    expect(screen.getByRole('textbox')).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: '发送消息' }));
    expect(onSendMessage).not.toHaveBeenCalled();
    view.unmount();
    renderChatRoom({ canSend: true, onSendMessage });
    expect(screen.getByRole('textbox')).toBeEnabled();
  });

  it('blocks dropped files while archived and allows them after restoring', async () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true });
    const view = renderChatRoom({ canSend: false });
    const dataTransfer = { types: ['Files'], files: [new File(['result'], 'result.txt')] };
    await act(async () => { fireEvent.drop(view.container.firstElementChild!, { dataTransfer }); });
    expect(mocks.uploadMutateAsync).not.toHaveBeenCalled();
    view.rerender(<ChatProvider><ChatRoom roomId="!room:test" roomName="测试房间" canSend /></ChatProvider>);
    await act(async () => { fireEvent.drop(view.container.firstElementChild!, { dataTransfer }); });
    expect(mocks.uploadMutateAsync).toHaveBeenCalledOnce();
  });

  it('stops manual and automatic failed-message retries when the room is archived', async () => {
    vi.useFakeTimers();
    try {
      useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true });
      mocks.sendMutate.mockImplementationOnce((_args: unknown, callbacks: { onError: (_error: Error) => void }) => {
        callbacks.onError(new MatrixRequestError('rate limit', 'M_LIMIT_EXCEEDED', 429, 1000));
      });
      const view = renderChatRoom();
      fireEvent.change(screen.getByRole('textbox'), { target: { value: 'follow up' } });
      await act(async () => { fireEvent.click(screen.getByRole('button', { name: '发送消息' })); });
      expect(screen.getByTitle('重新发送')).toBeEnabled();
      view.rerender(<ChatProvider><ChatRoom roomId="!room:test" roomName="测试房间" canSend={false} /></ChatProvider>);
      act(() => { vi.advanceTimersByTime(2000); });
      expect(mocks.sendMutate).toHaveBeenCalledOnce();
      expect(screen.getByTitle('重新发送')).toBeDisabled();
      fireEvent.click(screen.getByTitle('重新发送'));
      expect(mocks.sendMutate).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
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

    const composer = screen.getByRole('textbox', { name: '消息' });
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

  it('keeps members and files mutually exclusive and closes the mobile context drawer', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true, homeserver: 'https://hs.test', accessToken: 'tok' });
    renderChatRoom();

    const composer = screen.getByRole('textbox', { name: '消息' });
    fireEvent.change(composer, { target: { value: '尚未发送的草稿' } });
    const timeline = screen.getByTestId('virtuoso');
    fireEvent.click(screen.getByTitle('显示成员'));
    expect(screen.getByRole('complementary', { name: '会话上下文面板' })).toHaveClass('absolute', 'right-0');
    expect(screen.getByText('成员 (0)')).toBeInTheDocument();
    fireEvent.click(screen.getByTitle('显示文件'));
    expect(screen.queryByText('成员 (0)')).toBeNull();
    expect(screen.getByText('当前会话暂无附件')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '关闭上下文面板' }));
    expect(screen.queryByText('当前会话暂无附件')).toBeNull();
    expect(screen.getByTestId('virtuoso')).toBe(timeline);
    expect(screen.getByRole('textbox', { name: '消息' })).toBe(composer);
    expect(composer).toHaveValue('尚未发送的草稿');
  });

  it('opens the floating panel on mouse entry and closes only after leaving the whole panel', async () => {
    vi.stubGlobal('PointerEvent', MouseEvent);
    vi.stubGlobal('matchMedia', vi.fn().mockReturnValue({ matches: true } as MediaQueryList));
    try {
      renderChatRoom({ integratedSidebar: true, roomTaskData: { board: { tasks: [] }, roots: [], snapshots: [], count: 0 } });
      const toggle = screen.getByRole('button', { name: '展开上下文面板' });
      const composer = screen.getByRole('textbox', { name: '消息' });
      const timeline = screen.getByTestId('virtuoso');
      fireEvent.change(composer, { target: { value: '保留草稿和滚动位置' } });
      expect(screen.getByRole('button', { name: '任务 0' })).toBeInTheDocument();

      const pointer = (type: string, target: HTMLElement, relatedTarget?: HTMLElement) => {
        const event = new MouseEvent(type, { bubbles: true, relatedTarget });
        Object.defineProperty(event, 'pointerType', { value: 'mouse' });
        fireEvent(target, event);
      };
      pointer('pointerover', toggle);
      const panel = screen.getByRole('complementary', { name: '会话上下文面板' });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: '收起上下文面板' })).toBe(toggle);
      pointer('pointerout', toggle, panel);
      pointer('pointerover', panel, toggle);
      expect(panel).toBeInTheDocument();
      pointer('pointerout', panel, composer);
      await waitFor(() => expect(panel).not.toBeInTheDocument());
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(screen.getByTestId('virtuoso')).toBe(timeline);
      expect(screen.getByRole('textbox', { name: '消息' })).toBe(composer);
      expect(composer).toHaveValue('保留草稿和滚动位置');

      fireEvent.click(toggle, { detail: 0 });
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      fireEvent.click(toggle, { detail: 0 });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it('lists room attachments, skips redacted files, and returns to the list after preview', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true, homeserver: 'https://hs.test', accessToken: 'tok' });
    mocks.olderMessages.hasNextPage = true;
    const event = {
      event_id: '$file', type: 'm.room.message', sender: '@peer:test', origin_server_ts: 3000,
      content: { body: 'report.md', msgtype: 'm.file', url: 'mxc://hs.test/report' },
    };
    mocks.roomMessagesChunk.push(
      event, event,
      { ...event, event_id: '$removed', content: { ...event.content, body: 'deleted.md' } },
      { event_id: '$redaction', type: 'm.room.redaction', sender: '@peer:test', origin_server_ts: 4000, content: { redacts: '$removed' } },
      { ...event, event_id: '$thread-file', content: { ...event.content, body: 'thread.html', 'm.relates_to': { rel_type: 'm.thread', event_id: '$new' } } },
    );
    renderChatRoom();
    fireEvent.click(screen.getByTitle('显示文件'));
    const files = within(screen.getByRole('region', { name: '会话附件' }));
    expect(files.getByRole('link', { name: '下载 report.md' })).toBeInTheDocument();
    expect(files.getByRole('button', { name: '查看 thread.html' })).toBeInTheDocument();
    expect(files.queryByText('deleted.md')).toBeNull();
    fireEvent.click(files.getByRole('button', { name: '加载更早附件' }));
    expect(mocks.olderMessages.fetchNextPage).toHaveBeenCalledTimes(1);

    fireEvent.click(files.getByRole('button', { name: '查看 report.md' }));
    const preview = within(screen.getByRole('complementary', { name: '文件预览' }));
    expect(preview.getByRole('heading', { name: 'report.md' })).toBeInTheDocument();
    fireEvent.click(preview.getByRole('button', { name: '关闭文件预览' }));
    expect(screen.getByRole('region', { name: '会话附件' })).toBeInTheDocument();
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

describe('ChatRoom HITL reply correlation', () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
    mocks.roomMembersChunk.length = 0;
    mocks.roomMessagesChunk.length = 2;
    mocks.roomMessagesData = { pages: [{ chunk: mocks.roomMessagesChunk }] };
    mocks.setAgentStatusMap({});
  });

  it('reconciles an approval receipt loaded in room history outside the global sweep', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true });
    useHitlInboxStore.setState({ confirmations: {}, resolutions: {} });
    const request = { version: 1, runtime: 'qwenpaw', request_id: 'req-history', tool_name: 'Bash', expires_at: 4000 };
    mocks.roomMessagesChunk.push(
      { event_id: '$pending-history', sender: '@agent:test', type: 'm.room.message', origin_server_ts: 3000,
        content: { msgtype: 'm.text', body: 'Approval', [RUNTIME_APPROVAL_KEY]: { ...request, status: 'pending' } } },
      { event_id: '$receipt-history', sender: '@agent:test', type: 'm.room.message', origin_server_ts: 3500,
        content: { msgtype: 'm.text', body: 'Approved', [RUNTIME_APPROVAL_KEY]: { ...request, status: 'approved' } } },
    );
    renderChatRoom();
    expect(screen.getByText('已批准', { exact: true })).toBeInTheDocument();
    expect(screen.queryByText('已超时', { exact: true })).not.toBeInTheDocument();
  });

  it('sends the intervention answer with an m.reference to its card event', () => {
    useMatrixStore.setState({ userId: '@me:test', isLoggedIn: true, homeserver: 'https://hs.test', accessToken: 'tok' });
    mocks.roomMessagesChunk.push({
      event_id: '$card',
      sender: '@agent:test',
      type: 'm.room.message',
      origin_server_ts: Date.now(),
      content: {
        msgtype: 'm.text',
        body: '请选择页面类型',
        'org.agentteams.run': {
          version: '1',
          blocks: [
            {
              type: 'confirmation',
              tool_name: 'ask_human',
              confirmation_id: 'conf-card',
              question: '请选择页面类型',
              options: [{ id: 'landing', label: '落地页', recommended: true }],
            },
          ],
        },
      },
    });

    renderChatRoom();
    fireEvent.click(screen.getByRole('button', { name: /提交选择/ }));

    expect(mocks.sendMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        roomId: '!room:test',
        body: expect.stringContaining('【干预答复】'),
        relatesTo: { rel_type: 'm.reference', event_id: '$card' },
      }),
      expect.anything(),
    );
  });
});

describe('takeRoomSearchDeepLink（B-1：面板命中带回的检索词）', () => {
  // replaceState 不触发 hashchange，正好用来单独验解析这一段。
  const setHash = (hash: string) => window.history.replaceState(null, '', `#${hash}`);

  beforeEach(() => resetRoomSearchDeepLinkForTests());
  afterEach(() => setHash('workbench/space'));

  it('认得面板写的 #workbench/space/<roomId>?q=…，并且同一个 hash 只交一次', () => {
    setHash(`${roomHash('!room:test').slice(1)}?q=${encodeURIComponent('缓存')}`);
    expect(takeRoomSearchDeepLink()).toBe('缓存');
    // ChatRoom 按房间 key 重挂载；交第二次的话，地址里残留的 ?q= 会把搜索条反复弹开。
    expect(takeRoomSearchDeepLink()).toBeNull();
  });

  it('路径不是会话页就不认：这个词在别的界面上没有意义', () => {
    setHash(`workbench/tasks?q=${encodeURIComponent('缓存')}`);
    expect(takeRoomSearchDeepLink()).toBeNull();
  });

  it('会话页上没有 q 时返回 null（普通进房不该弹搜索条）', () => {
    setHash('workbench/space');
    expect(takeRoomSearchDeepLink()).toBeNull();
  });
});
