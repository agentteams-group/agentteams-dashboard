import { describe, expect, it, vi, beforeEach } from 'vitest';
import { fetchProjectRoomTs } from '@/lib/project-room-ts';

const getRoomMessages = vi.fn();

vi.mock('@/lib/matrix-api', () => ({
  matrixApi: {
    getRoomMessages: (...args: unknown[]) => getRoomMessages(...args),
  },
}));

beforeEach(() => {
  getRoomMessages.mockReset();
});

describe('fetchProjectRoomTs', () => {
  it('returns the last event origin_server_ts (dir=b limit=1)', async () => {
    getRoomMessages.mockResolvedValue({
      chunk: [{ origin_server_ts: 1_700_000_123_000 }],
      start: 's',
      end: 'e',
    });
    await expect(
      fetchProjectRoomTs('http://hs', 'tok', '!room:hs'),
    ).resolves.toBe(1_700_000_123_000);
    expect(getRoomMessages).toHaveBeenCalledWith('http://hs', 'tok', '!room:hs', {
      dir: 'b',
      limit: 1,
    });
  });

  it('returns 0 for an empty room (no events)', async () => {
    getRoomMessages.mockResolvedValue({ chunk: [], start: 's', end: 'e' });
    await expect(
      fetchProjectRoomTs('http://hs', 'tok', '!empty:hs'),
    ).resolves.toBe(0);
  });

  it('returns 0 (never throws) when the room is unreadable — name-order fallback', async () => {
    getRoomMessages.mockRejectedValue(new Error('403 forbidden'));
    await expect(
      fetchProjectRoomTs('http://hs', 'tok', '!gone:hs'),
    ).resolves.toBe(0);
  });

  it('returns 0 without calling the API when any credential/room is missing', async () => {
    await expect(
      fetchProjectRoomTs('', 'tok', '!room:hs'),
    ).resolves.toBe(0);
    await expect(
      fetchProjectRoomTs('http://hs', '', '!room:hs'),
    ).resolves.toBe(0);
    await expect(
      fetchProjectRoomTs('http://hs', 'tok', ''),
    ).resolves.toBe(0);
    expect(getRoomMessages).not.toHaveBeenCalled();
  });
});
