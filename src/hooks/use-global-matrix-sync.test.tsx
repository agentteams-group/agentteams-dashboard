import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useGlobalMatrixSync } from './use-global-matrix-sync';
import { matrixApi, type MatrixEvent, type MatrixJoinedRoom, type MatrixSyncResponse } from '@/lib/matrix-api';
import { useMatrixStore } from '@/lib/matrix-store';
import { useReceiptStore, useRoomMetaStore, useTypingStore } from './use-matrix';
import { useTaskStore } from '@/lib/task-store';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
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
  beforeEach(() => {
    vi.useFakeTimers();
    resetStores();
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockReset();
    (matrixApi.getJoinedRooms as ReturnType<typeof vi.fn>).mockResolvedValue({ joined_rooms: [] });
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
    expect(meta['!r1:test'].unreadCount).toBe(2);
    expect(meta['!r2:test'].lastMessageTs).toBe(2000);

    unmount();
  });

  it('parses m.receipt ephemeral events into the receipt store for any room', async () => {
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
    expect(receipts['@alice:test']).toEqual({ eventId: '$evt:test', ts: 555 });

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

  it('merges timeline events only for the active room', async () => {
    useRoomMetaStore.getState().setActiveRoomId('!r1:test');
    (matrixApi.sync as ReturnType<typeof vi.fn>).mockResolvedValue(
      syncWith({
        '!r1:test': joinedRoom({
          timeline: { events: [msgEvent('$new1', 1000)], limited: false, prev_batch: 'p' },
        }),
        '!r2:test': joinedRoom({
          timeline: { events: [msgEvent('$new2', 2000)], limited: false, prev_batch: 'p' },
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
    expect(r2.pages[0].chunk.map((e) => e.event_id)).not.toContain('$new2');

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

    const items = Object.values(useHitlInboxStore.getState().confirmations);
    expect(items).toHaveLength(1);
    expect(items[0].toolName).toBe('execute_shell_command');
    expect(items[0].roomId).toBe('!r1:test');

    unmount();
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
    const items = Object.values(useHitlInboxStore.getState().confirmations);
    expect(items).toHaveLength(1);
    expect(items[0].toolName).toBe('execute_shell_command');
    expect(items[0].roomId).toBe('!hist:test');

    unmount();
  });
});
