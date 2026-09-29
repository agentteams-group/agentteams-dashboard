import { describe, expect, it } from 'vitest';

import {
  DONE_WINDOW_MS,
  INACTIVE_PHASES,
  roomHasRunningWorker,
  roomWorkerState,
  workerSessionState,
  deriveWorkerSessionState,
} from './worker-session-state';
import type { SessionRoomLike } from './worker-session-state';

const W1 = '@w1:hs';
const W2 = '@w2:hs';
const HUMAN = '@human:hs';

describe('workerSessionState (A17 — plugin 1:1 port)', () => {
  const now = 1_758_000_000_000;

  it('typing in any of the worker\'s rooms → running', () => {
    const rooms: SessionRoomLike[] = [
      { typing: [W1], lastMessageTs: 0, memberIds: [W1] },
      { typing: [], lastMessageTs: now, memberIds: [W2] },
    ];
    expect(workerSessionState(W1, rooms, now)).toBe('running');
  });

  it('typing wins over a fresh lastMessageTs (priority)', () => {
    const rooms: SessionRoomLike[] = [
      { typing: [W1], lastMessageTs: now, memberIds: [W1] },
    ];
    expect(workerSessionState(W1, rooms, now)).toBe('running');
  });

  it('activity within the done window → done', () => {
    const rooms: SessionRoomLike[] = [
      { typing: [], lastMessageTs: now - 5 * 60 * 1000, memberIds: [W1] },
    ];
    expect(workerSessionState(W1, rooms, now)).toBe('done');
  });

  it('boundary: exactly DONE_WINDOW_MS ago is still done', () => {
    const rooms: SessionRoomLike[] = [
      { typing: [], lastMessageTs: now - DONE_WINDOW_MS, memberIds: [W1] },
    ];
    expect(workerSessionState(W1, rooms, now)).toBe('done');
  });

  it('boundary: one ms past the window → idle', () => {
    const rooms: SessionRoomLike[] = [
      { typing: [], lastMessageTs: now - DONE_WINDOW_MS - 1, memberIds: [W1] },
    ];
    expect(workerSessionState(W1, rooms, now)).toBe('idle');
  });

  it('no lastMessageTs → idle', () => {
    const rooms: SessionRoomLike[] = [{ typing: [], memberIds: [W1] }];
    expect(workerSessionState(W1, rooms, now)).toBe('idle');
  });

  it('member gate: activity in a room the worker is not a member of → idle', () => {
    const rooms: SessionRoomLike[] = [
      { typing: [], lastMessageTs: now, memberIds: [W2] },
    ];
    expect(workerSessionState(W1, rooms, now)).toBe('idle');
  });

  it('cross-room: done in one room counts (worker has 1:1 + team rooms)', () => {
    const rooms: SessionRoomLike[] = [
      { typing: [], lastMessageTs: now, memberIds: [HUMAN, W2] }, // team room, not ours
      { typing: [], lastMessageTs: now - 60_000, memberIds: [HUMAN, W1] }, // our 1:1
    ];
    expect(workerSessionState(W1, rooms, now)).toBe('done');
  });

  it('cross-room: team-room activity must NOT make another worker done', () => {
    const rooms: SessionRoomLike[] = [
      { typing: [], lastMessageTs: now, memberIds: [HUMAN, W2, W1] },
    ];
    // W1 is a member and the room is fresh — per the plugin semantics this
    // IS done for a worker that lists that room among its rooms (the member
    // gate passes). Team rooms never show done is enforced at the team-room
    // PLACEMENT (running-only), not here.
    expect(workerSessionState(W1, rooms, now)).toBe('done');
  });

  it('undefined mxid → idle', () => {
    expect(workerSessionState(undefined, [], now)).toBe('idle');
  });

  it('no rooms → idle', () => {
    expect(workerSessionState(W1, [], now)).toBe('idle');
  });
});

describe('roomWorkerState (1:1 room header)', () => {
  const now = 1_758_000_000_000;

  it('a member worker typing → running', () => {
    expect(
      roomWorkerState({ typing: [W1], lastMessageTs: now - 60 * 60 * 1000 }, new Set([W1, W2]), now),
    ).toBe('running');
  });

  it('a non-member typing does not count', () => {
    expect(
      roomWorkerState({ typing: [HUMAN] }, new Set([W1]), now),
    ).toBe('idle');
  });

  it('recent activity, nobody typing → done', () => {
    expect(roomWorkerState({ typing: [], lastMessageTs: now - 60_000 }, new Set([W1]), now)).toBe('done');
  });

  it('stale activity → idle', () => {
    expect(
      roomWorkerState({ typing: [], lastMessageTs: now - DONE_WINDOW_MS - 1 }, new Set([W1]), now),
    ).toBe('idle');
  });
});

describe('workerSessionState — phase gate (container stopped → idle)', () => {
  const now = 1_758_000_000_000;
  const freshRooms: SessionRoomLike[] = [
    { typing: [W1], lastMessageTs: now, memberIds: [W1] },
  ];

  it.each(['Stopped', 'Failed', 'Sleeping', 'Pending'])(
    'phase=%s forces idle even while typing',
    (phase) => {
      expect(workerSessionState(W1, freshRooms, now, phase)).toBe('idle');
    },
  );

  it('INACTIVE_PHASES set contains the four inactive phases', () => {
    expect(INACTIVE_PHASES.has('Stopped')).toBe(true);
    expect(INACTIVE_PHASES.has('Failed')).toBe(true);
    expect(INACTIVE_PHASES.has('Sleeping')).toBe(true);
    expect(INACTIVE_PHASES.has('Pending')).toBe(true);
    expect(INACTIVE_PHASES.has('Running')).toBe(false);
    expect(INACTIVE_PHASES.has('Ready')).toBe(false);
  });

  it('phase=Running (active) does not gate — typing still wins', () => {
    expect(workerSessionState(W1, freshRooms, now, 'Running')).toBe('running');
  });

  it('phase=Ready (active) does not gate', () => {
    const doneRooms: SessionRoomLike[] = [
      { typing: [], lastMessageTs: now - 60_000, memberIds: [W1] },
    ];
    expect(workerSessionState(W1, doneRooms, now, 'Ready')).toBe('done');
  });
});

describe('deriveWorkerSessionState — phase gate', () => {
  const now = 1_758_000_000_000;

  it('Stopped + stale lastFinishAt inside the 10-min window → idle', () => {
    expect(
      deriveWorkerSessionState({
        agentStatus: { lastFinishAt: new Date(now - 5 * 60 * 1000).toISOString() },
        isTyping: false,
        lastMessageTs: now - 60_000,
        now,
        phase: 'Stopped',
      }),
    ).toBe('idle');
  });

  it('Stopped + worker still typing → idle (typing keep-alive has no ceiling)', () => {
    expect(
      deriveWorkerSessionState({
        agentStatus: { agentStatus: 'running', runningTaskCount: 1 },
        isTyping: true,
        lastMessageTs: now,
        now,
        phase: 'Stopped',
      }),
    ).toBe('idle');
  });

  it('Running phase + running heartbeat → running (no gate)', () => {
    expect(
      deriveWorkerSessionState({
        agentStatus: { agentStatus: 'running', runningTaskCount: 1 },
        isTyping: false,
        now,
        phase: 'Running',
      }),
    ).toBe('running');
  });
});

describe('roomHasRunningWorker (team rooms — running only, v1.51)', () => {
  it('any of the room\'s workers typing → true', () => {
    expect(
      roomHasRunningWorker({ typing: [HUMAN, W2] }, [W1, W2]),
    ).toBe(true);
  });

  it('only humans typing → false', () => {
    expect(roomHasRunningWorker({ typing: [HUMAN] }, [W1, W2])).toBe(false);
  });

  it('no worker list → false (manager/human rooms get no dot)', () => {
    expect(roomHasRunningWorker({ typing: [W1] }, undefined)).toBe(false);
    expect(roomHasRunningWorker({ typing: [W1] }, [])).toBe(false);
  });

  it('no typing at all → false', () => {
    expect(roomHasRunningWorker({}, [W1])).toBe(false);
  });
});
