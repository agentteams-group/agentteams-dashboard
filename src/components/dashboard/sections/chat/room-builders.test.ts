import { describe, it, expect } from 'vitest';
import type { ManagerResponse, TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import { buildRooms, filterRooms, sortRoomsByRecency } from './room-builders';
import type { RoomInfo } from './room-info';

const team = (overrides: Partial<TeamResponse> = {}): TeamResponse => ({
  name: 't1',
  teamName: 'T1',
  description: '',
  phase: 'Active',
  admin: null,
  humanMembers: [],
  leaderName: '',
  leaderHeartbeat: null,
  workerIdleTimeout: '30m',
  teamRoomID: '!team:matrix',
  leaderDMRoomID: '',
  leaderReady: true,
  readyWorkers: 0,
  totalWorkers: 0,
  message: '',
  workerNames: [],
  workerExposedPorts: {},
  ...overrides,
});

const worker = (overrides: Partial<WorkerResponse> = {}): WorkerResponse => ({
  name: 'w1',
  phase: 'Running',
  state: 'Running',
  runtime: 'openclaw',
  containerManaged: false,
  model: '',
  image: '',
  containerState: '',
  matrixUserID: '@w1:matrix',
  roomID: '!w1:matrix',
  message: '',
  team: 't1',
  role: '',
  ...overrides,
});

const manager = (overrides: Partial<ManagerResponse> = {}): ManagerResponse => ({
  name: 'm1',
  phase: 'Running',
  state: 'Running',
  model: 'gpt-4',
  runtime: 'openclaw',
  image: '',
  matrixUserID: '@m1:matrix',
  roomID: '!m1:matrix',
  version: '',
  message: '',
  welcomeSent: false,
  ...overrides,
});

describe('buildRooms', () => {
  it('returns empty when no data', () => {
    expect(buildRooms(undefined, undefined, undefined)).toEqual([]);
  });

  it('builds team rooms', () => {
    const rooms = buildRooms(undefined, [team({ name: 'alpha', teamRoomID: '!t1:matrix' })], undefined);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].type).toBe('team');
    expect(rooms[0].parentTeam).toBe('alpha');
  });

  it('skips teams without teamRoomID', () => {
    const rooms = buildRooms(undefined, [team({ teamRoomID: '' })], undefined);
    expect(rooms).toEqual([]);
  });

  it('builds worker rooms with matrixUserID', () => {
    const rooms = buildRooms(
      [worker({ name: 'w1', roomID: '!w:matrix', matrixUserID: '@w:matrix' })],
      undefined,
      undefined,
    );
    expect(rooms).toHaveLength(1);
    expect(rooms[0].type).toBe('worker');
    expect(rooms[0].members).toEqual(['@w:matrix']);
  });

  it('skips workers without roomID', () => {
    const rooms = buildRooms([worker({ roomID: '' })], undefined, undefined);
    expect(rooms).toEqual([]);
  });

  it('builds manager rooms', () => {
    const rooms = buildRooms(undefined, undefined, [manager({ name: 'm1' })]);
    expect(rooms).toHaveLength(1);
    expect(rooms[0].type).toBe('manager');
  });

  it('combines all sources in order', () => {
    const rooms = buildRooms(
      [worker({ name: 'w' })],
      [team({ name: 't' })],
      [manager({ name: 'm' })],
    );
    expect(rooms.map((r) => r.type)).toEqual(['team', 'worker', 'manager']);
  });
});

describe('filterRooms', () => {
  const rooms: RoomInfo[] = [
    { id: '!a:matrix', name: 'Alpha Team', type: 'team', members: ['@alice:matrix'], parentTeam: 'alpha', phase: 'Active' },
    { id: '!b:matrix', name: 'Bob Worker', type: 'worker', members: ['@bob:matrix'], parentTeam: 'b', phase: 'Running' },
    { id: '!c:matrix', name: 'Charlie Manager', type: 'manager', members: ['@charlie:matrix'], matrixUserId: '@charlie:matrix', phase: 'Active' },
  ];

  it('returns all when filter empty', () => {
    expect(filterRooms(rooms, '')).toEqual(rooms);
  });

  it('matches by name case-insensitively', () => {
    expect(filterRooms(rooms, 'ALPHA')).toHaveLength(1);
  });

  it('matches by id', () => {
    expect(filterRooms(rooms, '!b:matrix')).toHaveLength(1);
  });

  it('matches by member', () => {
    expect(filterRooms(rooms, 'charlie')).toHaveLength(1);
  });

  it('returns empty for no match', () => {
    expect(filterRooms(rooms, 'zzz')).toEqual([]);
  });
});

describe('sortRoomsByRecency', () => {
  const make = (overrides: Partial<RoomInfo>): RoomInfo => ({
    id: overrides.id ?? '!r:m',
    name: overrides.name ?? 'r',
    type: overrides.type ?? 'team',
    members: overrides.members ?? [],
    ...overrides,
  });

  it('returns empty for empty input', () => {
    expect(sortRoomsByRecency([])).toEqual([]);
  });

  it('unread rooms float above read rooms', () => {
    const read = make({ id: 'a', name: 'A', lastMessageTs: 5000 });
    const unread = make({ id: 'b', name: 'B', lastMessageTs: 100, unreadCount: 1 });
    const out = sortRoomsByRecency([read, unread]);
    expect(out.map((r) => r.id)).toEqual(['b', 'a']);
  });

  it('unread with highlight pinned above unread without', () => {
    const plain = make({ id: 'p', name: 'P', unreadCount: 5 });
    const highlight = make({ id: 'h', name: 'H', unreadCount: 1, unreadHighlightCount: 1 });
    const out = sortRoomsByRecency([plain, highlight]);
    expect(out.map((r) => r.id)).toEqual(['h', 'p']);
  });

  it('among read rooms, sort by lastMessageTs desc', () => {
    const older = make({ id: 'o', name: 'O', lastMessageTs: 100 });
    const newer = make({ id: 'n', name: 'N', lastMessageTs: 200 });
    const noTs = make({ id: 'x', name: 'X' });
    const out = sortRoomsByRecency([noTs, older, newer]);
    expect(out.map((r) => r.id)).toEqual(['n', 'o', 'x']);
  });

  it('does not mutate input array', () => {
    const a = make({ id: 'a', name: 'A', lastMessageTs: 100 });
    const b = make({ id: 'b', name: 'B', lastMessageTs: 200 });
    const input = [a, b];
    sortRoomsByRecency(input);
    expect(input).toEqual([a, b]);
  });
});
