import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGlobalMatrixSync } from './use-global-matrix-sync';
import { useChatRoomAccess } from './use-chat-room-access';
import { matrixApi, type MatrixEvent, type MatrixJoinedRoom, type MatrixRoomStateEvent, type MatrixSyncResponse } from '@/lib/matrix-api';
import { useMatrixStore } from '@/lib/matrix-store';
import { useReceiptStore, useRoomMetaStore, useTypingStore } from './use-matrix';
import { useTaskStore } from '@/lib/task-store';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { consumeBufferedEvents, resetSyncBufferForTests } from '@/lib/matrix-sync-buffer';
import type { ReactNode } from 'react';

vi.mock('@/lib/matrix-api', async () => {
  const actual = await vi.importActual<typeof import('@/lib/matrix-api')>('@/lib/matrix-api');
  return {
    ...actual,
    matrixApi: {
      ...actual.matrixApi,
      sync: vi.fn(),
      getJoinedRooms: vi.fn(),
      getRoomMessages: vi.fn(),
      getRoomState: vi.fn(),
      getRoomEvent: vi.fn(),
    },
  };
});

function wrapWithQueryClient(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
}

/** Fresh QueryClient with retries disabled so poll errors surface immediately. */
function getQueryClientMock(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
}

/** Seed the React Query cache for a room's message pages. */
function setRoomCache(queryClient: QueryClient, roomId: string, chunk: MatrixEvent[]): void {
  queryClient.setQueryData(['matrix-messages', roomId], {
    pages: [{ chunk }],
    pageParams: [undefined],
  });
}

/** Reset all relevant stores + timers so each test starts clean. */
function resetStores() {
  useMatrixStore.setState({
    homeserver: 'https://matrix.test',
    accessToken: 'tok',
    userId: '@user:test',
    deviceId: 'dev',
    isLoggedIn: true,
    isLoggingIn: false,
    loginError: null,
    syncToken: null,
    isSyncing: false,
    syncGeneration: 0,
  });
  useRoomMetaStore.setState({ meta: {}, activeRoomId: null });
  useReceiptStore.setState({ receipts: {} });
  useTypingStore.setState({ typingUsers: {}, expiryMap: {} });
  useTaskStore.setState({ tasks: {} });
  useHitlInboxStore.setState({ confirmations: {}, pendingChatRoomId: null, pendingProjectKey: null });
}

const msgEvent = (eventId: string, ts: number, extra: Record<string, unknown> = {}): MatrixEvent => ({
  event_id: eventId,
  sender: '@agent:test',
  type: 'm.room.message',
  origin_server_ts: ts,
  content: { msgtype: 'm.text', body: `msg ${eventId}`, ...extra },
});

const syncWith = (rooms: Record<string, MatrixJoinedRoom>): MatrixSyncResponse => ({
  next_batch: 'batch-1',
  rooms: { join: rooms },
});

/** Base joined-room shape; tests may override timeline/state/ephemeral. */
const joinedRoom = (overrides: Partial<MatrixJoinedRoom> = {}): MatrixJoinedRoom => ({
  timeline: { events: [], limited: false, prev_batch: 'p' },
  state: { events: [] },
  summary: { joined_member_count: 0, invited_member_count: 0 },
  ...overrides,
});

describe('useGlobalMatrixSync', () => {
  it('hydrates exact receipts without rendering them or reordering the room', async () => {
    const rid = '!receipt:test';
    const queryClient = getQueryClientMock();
    setRoomCache(queryClient, rid, [msgEvent('$message', 100)]);
    useRoomMetaStore.getState().setRoomMeta(rid, { lastMessageTs: 100 });
    const receipt: MatrixEvent = {
      event_id: '$ack', sender: '@agent:test', type: 'com.agentteams.session_receipt', origin_server_ts: 9999,
      content: { version: 1, status: 'read', 'm.relates_to': { rel_type: 'com.agentteams.session_receipt', event_id: '$message' } },
    };
    vi.mocked(matrixApi.sync).mockResolvedValueOnce(syncWith({ [rid]: joinedRoom({ timeline: { events: [receipt], limited: false, prev_batch: 'p' } }) }));
    const { unmount } = renderHook(() => useGlobalMatrixSync(), { wrapper: wrapWithQueryClient(queryClient) });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(useRoomMetaStore.getState().meta[rid].lastMessageTs).toBe(100);
    expect(queryClient.getQueryData(['message-read-status', 'https://matrix.test', '@user:test', rid, '$message'])).toEqual([receipt]);
    expect(queryClient.getQueryData<{ pages: Array<{ chunk: MatrixEvent[] }> }>(['matrix-messages', rid])?.pages[0].chunk.map((event) => event.event_id)).toEqual(['$message']);
    unmount();
  });
  it('refreshes resource projections on a new join, without refreshing on every message', async () => {
    vi.useFakeTimers();
    resetStores();
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(syncWith({ '!new:test': joinedRoom({}) }));
    const queryClient = getQueryClientMock();
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { unmount } = renderHook(() => useGlobalMatrixSync(), { wrapper: wrapWithQueryClient(queryClient) });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['agentteams-teams'] });
    const count = invalidate.mock.calls.length;
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(invalidate.mock.calls.length).toBe(count);
    unmount();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    resetStores();
    resetSyncBufferForTests();
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockReset();
    (matrixApi.getJoinedRooms as ReturnType<typeof vi.fn>).mockResolvedValue({ joined_rooms: [] });
    (matrixApi.getRoomState as ReturnType<typeof vi.fn>).mockResolvedValue([]);
    (matrixApi.getRoomEvent as ReturnType<typeof vi.fn>).mockImplementation(async (_hs, _token, _rid, eventId) => msgEvent(eventId, 400));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('writes room meta (lastMessageTs + unread counts) for every joined room', async () => {
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(
      syncWith({
        '!r1:test': joinedRoom({
          timeline: { events: [msgEvent('$e1', 1000)], limited: false, prev_batch: 'p' },
          unread_notifications: { highlight_count: 0, notification_count: 2 },
        }),
        '!r2:test': joinedRoom({
          timeline: { events: [msgEvent('$e2', 2000)], limited: false, prev_batch: 'p' },
        }),
      }),
    );

    const queryClient = getQueryClientMock();
    const { unmount } = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(queryClient),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const meta = useRoomMetaStore.getState().meta;
    expect(meta['!r1:test'].lastMessageTs).toBe(1000);
    expect(meta['!r1:test'].lastMessagePreview).toBe('msg $e1');
    expect(meta['!r1:test'].unreadCount).toBe(2);
    expect(meta['!r2:test'].lastMessageTs).toBe(2000);
    expect(meta['!r2:test'].lastMessagePreview).toBe('msg $e2');

    unmount();
  });

  it('does not replace the sidebar preview or ordering with a background assistant wake', async () => {
    const wake = msgEvent('$wake', 2000, { msgtype: 'm.notice',
      'org.agentteams.coordination': { channel_meta: { sender_id: '@agent:test',
        agent_matrix_user_id: '@agent:test', teamharness_coordination: { kind: 'assistant_digest' } } },
    });
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(syncWith({
      '!r1:test': joinedRoom({ timeline: { events: [msgEvent('$answer', 1000), wake], limited: false, prev_batch: 'p' },
        unread_notifications: { highlight_count: 0, notification_count: 0 } }),
    }));
    const { unmount } = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(getQueryClientMock()),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(useRoomMetaStore.getState().meta['!r1:test']).toMatchObject({
      lastMessageTs: 1000, lastMessagePreview: 'msg $answer', unreadCount: 0,
    });
    unmount();
  });

  it('parses m.receipt ephemeral events into the receipt store for the active room', async () => {
    const rid = '!r1:test';
    useRoomMetaStore.getState().setActiveRoomId(rid);
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(
      syncWith({
        '!r1:test': joinedRoom({
          ephemeral: {
            events: [
              {
                type: 'm.receipt',
                content: {
                  '$evt:test': { 'm.read': { '@alice:test': { ts: 555 } } },
                },
              } as unknown as MatrixEvent,
            ],
          },
        }),
      }),
    );

    const queryClient = getQueryClientMock();
    const { unmount } = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(queryClient),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const receipts = useReceiptStore.getState().receipts['!r1:test'];
    expect(receipts['@alice:test']).toEqual({ eventId: '$evt:test', ts: 555, eventTimestamp: 400 });

    unmount();
  });

  it('does not resolve receipts for inactive rooms', async () => {
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(syncWith({
      '!inactive:test': joinedRoom({ ephemeral: { events: [readReceipt('$inactive-target', 500)] } }),
    }));
    const { unmount } = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(getQueryClientMock()),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(useReceiptStore.getState().receipts['!inactive:test']).toBeUndefined();
    expect(matrixApi.getRoomEvent).not.toHaveBeenCalled();
    unmount();
  });

  it('merges each reader to the newest receipt and resolves an event only once', async () => {
    const rid = '!receipt-merge:test';
    useRoomMetaStore.getState().setActiveRoomId(rid);
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(syncWith({
      [rid]: joinedRoom({ ephemeral: { events: [
        readReceipt('$old', 500),
        readReceipt('$latest', 700),
        { ...readReceipt('$latest', 700), event_id: '$duplicate' },
        {
          event_id: '$bob-receipt', sender: '@agent:test', type: 'm.receipt', origin_server_ts: 650,
          content: { '$bob-target': { 'm.read': { '@bob:test': { ts: 650 } } } },
        } as MatrixEvent,
      ] } }),
    }));
    const { unmount } = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(getQueryClientMock()),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(matrixApi.getRoomEvent).toHaveBeenCalledTimes(2);
    expect(matrixApi.getRoomEvent).toHaveBeenCalledWith(
      'https://matrix.test', 'tok', rid, '$latest',
    );
    expect(useReceiptStore.getState().receipts[rid]).toMatchObject({
      '@alice:test': { eventId: '$latest', ts: 700, eventTimestamp: 400 },
      '@bob:test': { eventId: '$bob-target', ts: 650, eventTimestamp: 400 },
    });
    unmount();
  });

  it('bounds concurrent receipt target lookups to four', async () => {
    const rid = '!receipt-concurrency:test';
    useRoomMetaStore.getState().setActiveRoomId(rid);
    const resolvers: Array<(_event: MatrixEvent) => void> = [];
    let active = 0;
    let maxActive = 0;
    (matrixApi.getRoomEvent as ReturnType<typeof vi.fn>).mockImplementation(() => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<MatrixEvent>((resolve) => {
        resolvers.push((event) => {
          active -= 1;
          resolve(event);
        });
      });
    });
    const ephemeral = Array.from({ length: 8 }, (_, index) => ({
      event_id: `$receipt-${index}`, sender: '@agent:test', type: 'm.receipt', origin_server_ts: 500 + index,
      content: { [`$target-${index}`]: { 'm.read': { [`@reader-${index}:test`]: { ts: 500 + index } } } },
    } as unknown as MatrixEvent));
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(syncWith({
      [rid]: joinedRoom({ ephemeral: { events: ephemeral } }),
    }));
    const { unmount } = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(getQueryClientMock()),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(maxActive).toBe(4);
    expect(matrixApi.getRoomEvent).toHaveBeenCalledTimes(4);
    await act(async () => {
      for (const resolve of resolvers.splice(0)) resolve(msgEvent('$target', 400));
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(matrixApi.getRoomEvent).toHaveBeenCalledTimes(8);
    await act(async () => {
      for (const resolve of resolvers.splice(0)) resolve(msgEvent('$target', 400));
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
  });

  it('parses m.typing ephemeral events into the typing store for any room', async () => {
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(
      syncWith({
        '!r1:test': joinedRoom({
          ephemeral: {
            events: [
              { type: 'm.typing', content: { user_ids: ['@bob:test'] } } as unknown as MatrixEvent,
            ],
          },
        }),
      }),
    );

    const queryClient = getQueryClientMock();
    const { unmount } = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(queryClient),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const users = useTypingStore.getState().typingUsers['!r1:test'];
    expect(users).toEqual([{ userId: '@bob:test', displayName: 'bob' }]);

    unmount();
  });

  it('deduplicates workflow events into the task store (same event ingested once)', async () => {
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(
      syncWith({
        '!r1:test': joinedRoom({
          timeline: {
            events: [
              msgEvent('$wf1', 1000, { 'agentteams.workflow': { runId: 'run-1', title: 'T', status: 'running' } }),
            ],
            limited: false,
            prev_batch: 'p',
          },
        }),
      }),
    );

    const queryClient = getQueryClientMock();
    const { unmount } = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(queryClient),
    });

    // First poll ingests the workflow event.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(useTaskStore.getState().tasks['run-1']).toBeDefined();
    expect(Object.keys(useTaskStore.getState().tasks)).toHaveLength(1);

    // A second poll returning the same event must not create a duplicate task.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });
    expect(Object.keys(useTaskStore.getState().tasks)).toHaveLength(1);

    unmount();
  });

  it('merges timeline events into every cached room (buffers uncached rooms)', async () => {
    useRoomMetaStore.getState().setActiveRoomId('!r1:test');
    // Buffer replay TTL-filters events older than 10min — use now-relative
    // timestamps so the buffered event survives.
    const now = Date.now();
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(
      syncWith({
        '!r1:test': joinedRoom({
          timeline: { events: [msgEvent('$new1', now - 3000)], limited: false, prev_batch: 'p' },
        }),
        '!r2:test': joinedRoom({
          timeline: { events: [msgEvent('$new2', now - 2000)], limited: false, prev_batch: 'p' },
        }),
        // No cache seeded for !r3:test — its event must land in the buffer,
        // not be dropped.
        '!r3:test': joinedRoom({
          timeline: { events: [msgEvent('$new3', now - 1000)], limited: false, prev_batch: 'p' },
        }),
      }),
    );

    const queryClient = getQueryClientMock();
    setRoomCache(queryClient, '!r1:test', []);
    setRoomCache(queryClient, '!r2:test', []);

    const { unmount } = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(queryClient),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const r1 = queryClient.getQueryData(['matrix-messages', '!r1:test']) as {
      pages: Array<{ chunk: MatrixEvent[] }>;
    };
    const r2 = queryClient.getQueryData(['matrix-messages', '!r2:test']) as {
      pages: Array<{ chunk: MatrixEvent[] }>;
    };
    expect(r1.pages[0].chunk.map((e) => e.event_id)).toContain('$new1');
    // Element-style realtime: a non-active room WITH a cache merges too —
    // no 10s polling needed to see new messages in background rooms.
    expect(r2.pages[0].chunk.map((e) => e.event_id)).toContain('$new2');
    // Uncached room: event buffered for replay on open, drained once.
    expect(consumeBufferedEvents('!r3:test').map((e) => e.event_id)).toContain('$new3');
    expect(consumeBufferedEvents('!r3:test')).toEqual([]);

    unmount();
  });

  function cachedIds(queryClient: QueryClient, roomId: string) {
    const data = queryClient.getQueryData<{ pages: Array<{ chunk: MatrixEvent[] }> }>(['matrix-messages', roomId]);
    return data?.pages.flatMap((page) => page.chunk.map((event) => event.event_id)) ?? [];
  }

  function redaction(target: string, ts = Date.now()): MatrixEvent {
    return {
      event_id: `$redact-${target}`, sender: '@mod:test', type: 'm.room.redaction',
      origin_server_ts: ts, redacts: target, content: {},
    };
  }

  function readReceipt(eventId: string, ts: number, threadId?: string): MatrixEvent {
    return {
      event_id: `$receipt-${eventId}-${ts}`, sender: '@agent:test', type: 'm.receipt', origin_server_ts: ts,
      content: { [eventId]: { 'm.read': { '@alice:test': { ts, ...(threadId ? { thread_id: threadId } : {}) } } } },
    } as MatrixEvent;
  }

  it('removes a redacted message and its revisions in the active room', async () => {
    const rid = '!open:test';
    useRoomMetaStore.getState().setActiveRoomId(rid);
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(syncWith({
      [rid]: joinedRoom({ timeline: { events: [redaction('$root')], limited: false, prev_batch: 'p' } }),
    }));
    const queryClient = getQueryClientMock();
    setRoomCache(queryClient, rid, [
      msgEvent('$root', 100),
      msgEvent('$revision', 200, { 'm.relates_to': { rel_type: 'm.replace', event_id: '$root' } }),
      msgEvent('$kept', 50),
    ]);
    const { unmount } = renderHook(() => useGlobalMatrixSync(), { wrapper: wrapWithQueryClient(queryClient) });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(cachedIds(queryClient, rid)).toEqual(['$kept']);
    unmount();
  });

  it('applies redactions to a recently visited room even when another room is active', async () => {
    useRoomMetaStore.getState().setActiveRoomId('!active:test');
    const rid = '!recent:test';
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(syncWith({
      [rid]: joinedRoom({ timeline: { events: [redaction('$old')], limited: false, prev_batch: 'p' } }),
    }));
    const queryClient = getQueryClientMock();
    setRoomCache(queryClient, rid, [msgEvent('$old', 100), msgEvent('$kept', 50)]);
    const { unmount } = renderHook(() => useGlobalMatrixSync(), { wrapper: wrapWithQueryClient(queryClient) });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(cachedIds(queryClient, rid)).toEqual(['$kept']);
    unmount();
  });

  it('invalidates a cached room when a redaction target is outside the loaded window', async () => {
    const rid = '!unknown:test';
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(syncWith({
      [rid]: joinedRoom({ timeline: { events: [redaction('$outside-window')], limited: false, prev_batch: 'p' } }),
    }));
    const queryClient = getQueryClientMock();
    setRoomCache(queryClient, rid, [msgEvent('$kept', 100)]);
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries');
    const { unmount } = renderHook(() => useGlobalMatrixSync(), { wrapper: wrapWithQueryClient(queryClient) });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['matrix-messages', rid], exact: true, refetchType: 'none' });
    unmount();
  });

  it('buffers a redaction for a room whose message cache is not mounted yet', async () => {
    const rid = '!unopened:test';
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(syncWith({
      [rid]: joinedRoom({ timeline: { events: [redaction('$outside-window')], limited: false, prev_batch: 'p' } }),
    }));
    const { unmount } = renderHook(() => useGlobalMatrixSync(), { wrapper: wrapWithQueryClient(getQueryClientMock()) });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(consumeBufferedEvents(rid).map((event) => event.redacts)).toEqual(['$outside-window']);
    unmount();
  });

  it('resolves a receipt to the target event timestamp and keeps unknown positions unread', async () => {
    const rid = '!receipt-target:test';
    useRoomMetaStore.getState().setActiveRoomId(rid);
    (matrixApi.getRoomEvent as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('not found'));
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValueOnce(syncWith({
      [rid]: joinedRoom({ ephemeral: { events: [readReceipt('$unknown', 500)] } }),
    })).mockResolvedValueOnce(syncWith({
      [rid]: joinedRoom({ ephemeral: { events: [readReceipt('$known', 600)] } }),
    }));
    const { unmount } = renderHook(() => useGlobalMatrixSync(), { wrapper: wrapWithQueryClient(getQueryClientMock()) });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(useReceiptStore.getState().receipts[rid]['@alice:test']).toEqual({ eventId: '$unknown', ts: 500 });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(useReceiptStore.getState().receipts[rid]['@alice:test']).toEqual({
      eventId: '$known', ts: 600, eventTimestamp: 400,
    });
    unmount();
  });

  it('keeps thread receipts separate from room-level read positions', async () => {
    const rid = '!thread-receipt:test';
    useRoomMetaStore.getState().setActiveRoomId(rid);
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(syncWith({
      [rid]: joinedRoom({ ephemeral: { events: [readReceipt('$root', 500, '$thread-root')] } }),
    }));
    const { unmount } = renderHook(() => useGlobalMatrixSync(), { wrapper: wrapWithQueryClient(getQueryClientMock()) });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    expect(useReceiptStore.getState().receipts[rid]).toEqual({
      '@alice:test|$thread-root': { eventId: '$root', ts: 500, eventTimestamp: 400, threadId: '$thread-root' },
    });
    expect(matrixApi.getRoomEvent).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('does not move a reader backwards when an older receipt arrives later', async () => {
    const rid = '!receipt-order:test';
    useRoomMetaStore.getState().setActiveRoomId(rid);
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValueOnce(syncWith({
      [rid]: joinedRoom({ ephemeral: { events: [readReceipt('$newer', 700)] } }),
    })).mockResolvedValueOnce(syncWith({
      [rid]: joinedRoom({ ephemeral: { events: [readReceipt('$older', 600)] } }),
    }));
    const { unmount } = renderHook(() => useGlobalMatrixSync(), { wrapper: wrapWithQueryClient(getQueryClientMock()) });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    expect(useReceiptStore.getState().receipts[rid]['@alice:test']).toMatchObject({ eventId: '$newer', ts: 700 });
    expect(matrixApi.getRoomEvent).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('ignores a delayed target lookup after a newer receipt has been accepted', async () => {
    const rid = '!receipt-delay:test';
    useRoomMetaStore.getState().setActiveRoomId(rid);
    let resolveOld!: (_event: MatrixEvent) => void;
    const oldTarget = new Promise<MatrixEvent>((resolve) => { resolveOld = resolve; });
    (matrixApi.getRoomEvent as ReturnType<typeof vi.fn>).mockImplementation((_hs, _token, _rid, eventId) =>
      eventId === '$old' ? oldTarget : Promise.resolve(msgEvent(eventId, 400)),
    );
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValueOnce(syncWith({
      [rid]: joinedRoom({ ephemeral: { events: [readReceipt('$old', 600)] } }),
    })).mockResolvedValueOnce(syncWith({
      [rid]: joinedRoom({ ephemeral: { events: [readReceipt('$new', 700)] } }),
    }));
    const { unmount } = renderHook(() => useGlobalMatrixSync(), { wrapper: wrapWithQueryClient(getQueryClientMock()) });
    await act(async () => { await vi.advanceTimersByTimeAsync(600); });
    await act(async () => { await vi.advanceTimersByTimeAsync(1100); });
    await act(async () => {
      resolveOld(msgEvent('$old', 50));
      await Promise.resolve();
    });
    expect(useReceiptStore.getState().receipts[rid]['@alice:test']).toEqual({
      eventId: '$new', ts: 700, eventTimestamp: 400,
    });
    unmount();
  });

  it('stops polling after logout (sync generation invalidated)', async () => {
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(
      syncWith({
        '!r1:test': joinedRoom(),
      }),
    );

    const queryClient = getQueryClientMock();
    const { unmount } = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(queryClient),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    const callsAfterFirst = (matrixApi.sync as ReturnType<typeof vi.fn>).mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1);

    // Logout bumps the generation; the next tick must not fire another sync.
    useMatrixStore.getState().logout();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect((matrixApi.sync as ReturnType<typeof vi.fn>).mock.calls.length).toBe(callsAfterFirst);

    unmount();
  });

  it('keeps using the same sync token across polls (no reset on room switch)', async () => {
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(
      syncWith({
        '!r1:test': joinedRoom(),
      }),
    );

    const queryClient = getQueryClientMock();
    const { unmount } = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(queryClient),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    // Switch room: the loop must NOT restart; the same sync fn receives `since` = batch-1.
    act(() => {
      useRoomMetaStore.getState().setActiveRoomId('!r2:test');
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100);
    });

    const calls = (matrixApi.sync as ReturnType<typeof vi.fn>).mock.calls;
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const [, , since] = calls[calls.length - 1] as [string, string, string | undefined];
    expect(since).toBe('batch-1');

    unmount();
  });

  it('ingests Tool Guard confirmation events into the HITL inbox', async () => {
    const body = `⏳ Waiting for approval / 等待审批

Tool / 工具: execute_shell_command
Triggered by / 触发来源: Tool Guard / 工具护栏
Parameters / 参数:
{ "command": "ls" }

💡 Triggered by tool guardrails
Type /approve to approve, or send any message to deny.`;

    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(
      syncWith({
        '!r1:test': joinedRoom({
          timeline: {
            events: [msgEvent('$hitl1', 1000, { body })],
            limited: false,
            prev_batch: 'p',
          },
        }),
      }),
    );

    const queryClient = getQueryClientMock();
    const { unmount } = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(queryClient),
    });

    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });

    const items: import('@/lib/hitl-inbox').HitlConfirmation[] = Object.values(useHitlInboxStore.getState().confirmations);
    expect(items).toHaveLength(1);
    expect(items[0].toolName).toBe('execute_shell_command');
    expect(items[0].roomId).toBe('!r1:test');

    unmount();
  });

  it('keeps polling in a remounted effect while the previous long-poll is in flight (FUNC-01)', async () => {
    // First poll hangs like a 25s long-poll; the old effect stays "busy".
    let resolveFirst!: (_v: MatrixSyncResponse) => void;
    const firstLongPoll = new Promise<MatrixSyncResponse>((resolve) => {
      resolveFirst = resolve;
    });
    const syncMock = matrixApi.sync as ReturnType<typeof vi.fn>;
    syncMock.mockImplementationOnce(() => firstLongPoll);
    syncMock.mockResolvedValue(
      syncWith({ '!r1:test': joinedRoom() }),
    );

    const queryClient = getQueryClientMock();
    const first = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(queryClient),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(syncMock.mock.calls.length).toBe(1); // first poll stuck in flight

    // Remount: StrictMode/error-boundary style re-creation. The previous
    // request is still pending, but the new effect must start its own loop
    // instead of waiting forever on a component-level busy flag.
    first.unmount();
    const queryClient2 = getQueryClientMock();
    const second = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(queryClient2),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(600);
    });
    expect(syncMock.mock.calls.length).toBeGreaterThanOrEqual(2);

    // Drain the orphaned first-generation request, then confirm the new
    // loop keeps polling (the chain did not die with the old effect).
    await act(async () => {
      resolveFirst(syncWith({ '!r1:test': joinedRoom() }));
      await vi.advanceTimersByTimeAsync(2000);
    });
    const callsAfterDrain = syncMock.mock.calls.length;
    expect(callsAfterDrain).toBeGreaterThanOrEqual(2);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    expect(syncMock.mock.calls.length).toBeGreaterThan(callsAfterDrain);

    second.unmount();
  });

  it('ingests HITL confirmations from historical message load (loadHistorical)', async () => {
    const body = `⏳ Waiting for approval / 等待审批
Tool / 工具: execute_shell_command
Triggered by / 触发来源: Tool Guard / 工具护栏
Parameters / 参数:
{ "command": "ls" }

💡 Triggered by tool guardrails
Type /approve to approve, or send any message to deny.`;

    // loadHistorical calls getJoinedRooms then getRoomMessages per room.
    (matrixApi.getJoinedRooms as ReturnType<typeof vi.fn>).mockResolvedValue({
      joined_rooms: ['!hist:test'],
    });
    (matrixApi.getRoomMessages as ReturnType<typeof vi.fn>).mockResolvedValue({
      chunk: [msgEvent('$hist-hitl', 5000, { body })],
      start: 's',
      end: 'e',
    });
    // sync mock must still resolve so the component mounts without error.
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(
      syncWith({
        '!hist:test': joinedRoom(),
      }),
    );

    const queryClient = getQueryClientMock();
    const { unmount } = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(queryClient),
    });

    // loadHistorical runs immediately on mount and returns a promise.
    await act(async () => {
      // allow the fire-and-forget loadHistorical to settle
      await vi.waitUntil(() => Object.values(useHitlInboxStore.getState().confirmations).length > 0, { timeout: 1000 });
    });
    const items: import('@/lib/hitl-inbox').HitlConfirmation[] = Object.values(useHitlInboxStore.getState().confirmations);
    expect(items).toHaveLength(1);
    expect(items[0].toolName).toBe('execute_shell_command');
    expect(items[0].roomId).toBe('!hist:test');

    unmount();
  });
});

describe('useGlobalMatrixSync — room name / member count backfill', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetStores();
    resetSyncBufferForTests();
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockReset();
    (matrixApi.getJoinedRooms as ReturnType<typeof vi.fn>).mockReset();
    (matrixApi.getRoomMessages as ReturnType<typeof vi.fn>).mockResolvedValue({ chunk: [], start: 's', end: 'e' });
    (matrixApi.getRoomState as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  /** Render + let the mount-time sweep and the first poll settle. */
  async function mountAndSettle() {
    const queryClient = getQueryClientMock();
    const hook = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(queryClient),
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2000);
    });
    return hook;
  }

  it('prioritizes the active and 19 most recent rooms, then defers the rest', async () => {
    const ids = Array.from({ length: 25 }, (_, i) => `!r${i}:test`);
    useRoomMetaStore.getState().setActiveRoomId('!r24:test');
    for (let i = 0; i < ids.length; i += 1) {
      useRoomMetaStore.getState().setRoomMeta(ids[i], { lastMessageTs: i });
    }
    (matrixApi.getJoinedRooms as ReturnType<typeof vi.fn>).mockResolvedValue({ joined_rooms: ids });
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(syncWith({}));
    const { unmount } = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(getQueryClientMock()),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    let probed = (matrixApi.getRoomState as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[2]);
    expect(probed).toHaveLength(20);
    expect(probed[0]).toBe('!r24:test');
    expect(new Set(probed)).toEqual(new Set(ids.slice(5)));
    expect(matrixApi.sync).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(500); });
    expect(matrixApi.sync).toHaveBeenCalledTimes(1);
    probed = (matrixApi.getRoomState as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[2]);
    expect(probed).toHaveLength(20);

    await act(async () => { await vi.advanceTimersByTimeAsync(1500); });
    probed = (matrixApi.getRoomState as ReturnType<typeof vi.fn>).mock.calls.map((call) => call[2]);
    expect(probed).toHaveLength(25);
    expect(new Set(probed)).toEqual(new Set(ids));
    unmount();
  });

  it('never runs more than six room metadata probes at once', async () => {
    const ids = Array.from({ length: 12 }, (_, i) => `!bounded${i}:test`);
    let active = 0;
    let maxActive = 0;
    const resolvers: Array<() => void> = [];
    (matrixApi.getRoomState as ReturnType<typeof vi.fn>).mockImplementation(() => {
      active += 1;
      maxActive = Math.max(maxActive, active);
      return new Promise<MatrixRoomStateEvent[]>((resolve) => {
        resolvers.push(() => {
          active -= 1;
          resolve([]);
        });
      });
    });
    (matrixApi.getJoinedRooms as ReturnType<typeof vi.fn>).mockResolvedValue({ joined_rooms: ids });
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(syncWith({}));
    const { unmount } = renderHook(() => useGlobalMatrixSync(), {
      wrapper: wrapWithQueryClient(getQueryClientMock()),
    });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(maxActive).toBe(6);
    expect(matrixApi.getRoomState).toHaveBeenCalledTimes(6);
    await act(async () => {
      for (const resolve of resolvers.splice(0)) resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(matrixApi.getRoomState).toHaveBeenCalledTimes(12);
    await act(async () => {
      for (const resolve of resolvers.splice(0)) resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    unmount();
  });

  it('shares the joined-room request with room access through the query cache', async () => {
    (matrixApi.getJoinedRooms as ReturnType<typeof vi.fn>).mockResolvedValue({ joined_rooms: ['!shared:test'] });
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(syncWith({}));
    const queryClient = getQueryClientMock();
    const { unmount } = renderHook(() => ({
      sync: useGlobalMatrixSync(),
      access: useChatRoomAccess(),
    }), { wrapper: wrapWithQueryClient(queryClient) });
    await act(async () => { await vi.advanceTimersByTimeAsync(0); });
    expect(matrixApi.getJoinedRooms).toHaveBeenCalledTimes(1);
    unmount();
  });

  it('skips rooms that already carry roomName + memberCount', async () => {
    useRoomMetaStore.getState().setRoomMeta('!known:test', { roomName: 'Known room', memberCount: 4 });
    (matrixApi.getJoinedRooms as ReturnType<typeof vi.fn>).mockResolvedValue({
      joined_rooms: ['!known:test', '!missing:test'],
    });
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(syncWith({}));

    const { unmount } = await mountAndSettle();

    const probed = (matrixApi.getRoomState as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2]);
    expect(probed).toEqual(['!missing:test']);

    unmount();
  });

  it('stores m.room.name and the joined member count from the probe', async () => {
    const state: MatrixRoomStateEvent[] = [
      { type: 'm.room.name', state_key: '', content: { name: '  Manager: default  ' } },
      { type: 'm.room.member', state_key: '@a:test', content: { membership: 'join' } },
      { type: 'm.room.member', state_key: '@b:test', content: { membership: 'join' } },
      { type: 'm.room.member', state_key: '@c:test', content: { membership: 'leave' } },
      { type: 'm.topic', state_key: '', content: { topic: 'x' } },
    ];
    (matrixApi.getRoomState as ReturnType<typeof vi.fn>).mockResolvedValue(state);
    (matrixApi.getJoinedRooms as ReturnType<typeof vi.fn>).mockResolvedValue({ joined_rooms: ['!sv0d:test'] });
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(syncWith({}));

    const { unmount } = await mountAndSettle();

    const meta = useRoomMetaStore.getState().meta['!sv0d:test'];
    expect(meta.roomName).toBe('Manager: default');
    expect(meta.memberCount).toBe(2);

    unmount();
  });

  it('backfills a room that only appears in /sync (joined mid-session) and never re-probes it', async () => {
    // Sweep sees nothing — the room was created/joined afterwards.
    (matrixApi.getJoinedRooms as ReturnType<typeof vi.fn>).mockResolvedValue({ joined_rooms: [] });
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(
      syncWith({ '!late:test': joinedRoom() }),
    );

    const { unmount } = await mountAndSettle();

    const probed = (matrixApi.getRoomState as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2]);
    expect(probed.filter((r) => r === '!late:test')).toHaveLength(1);

    unmount();
  });

  it('probes rooms that /sync leaves without a state name (quiet rooms)', async () => {
    // The initial sync carries only the message timeline; no m.room.name and
    // no member summary — the probe must fill both.
    (matrixApi.getJoinedRooms as ReturnType<typeof vi.fn>).mockResolvedValue({ joined_rooms: ['!quiet:test'] });
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(
      syncWith({ '!quiet:test': joinedRoom({ timeline: { events: [msgEvent('$q1', 1000)], limited: false, prev_batch: 'p' } }) }),
    );

    const { unmount } = await mountAndSettle();

    const probed = (matrixApi.getRoomState as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[2]);
    expect(probed).toContain('!quiet:test');
    // lastMessageTs from the timeline still lands even though the probe fills the rest.
    expect(useRoomMetaStore.getState().meta['!quiet:test'].lastMessageTs).toBe(1000);

    unmount();
  });
});
