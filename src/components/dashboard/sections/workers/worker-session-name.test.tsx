import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { useRoomMetaStore, useTypingStore } from '@/hooks/use-matrix';
import { WorkerSessionName } from './worker-session-name';

const ROOM = '!room:hs';
const MXID = '@w1:hs';
const WORKER = { name: 'w1', matrixUserID: MXID, roomID: ROOM };

describe('WorkerSessionName (A17 store wiring)', () => {
  afterEach(() => {
    cleanup();
    useTypingStore.getState().setTypingUsers(ROOM, []);
    useRoomMetaStore.setState({ meta: {} });
  });

  it('no data → idle (无任务)', () => {
    render(<WorkerSessionName worker={WORKER} />);
    expect(screen.getByLabelText('无任务')).toBeTruthy();
  });

  it('worker typing in its room → running (运行中)', () => {
    useTypingStore.getState().setTypingUsers(ROOM, [{ userId: MXID, displayName: 'w1' }]);
    render(<WorkerSessionName worker={WORKER} />);
    expect(screen.getByLabelText('运行中')).toBeTruthy();
  });

  it('fresh last message, nobody typing → done (运行完成)', () => {
    useRoomMetaStore.getState().setRoomMeta(ROOM, { lastMessageTs: Date.now() });
    render(<WorkerSessionName worker={WORKER} />);
    expect(screen.getByLabelText('运行完成')).toBeTruthy();
  });

  it('worker without a Matrix identity → name only, no dot', () => {
    render(<WorkerSessionName worker={{ name: 'plain', roomID: ROOM }} />);
    expect(screen.queryByLabelText('无任务')).toBeNull();
    expect(screen.queryByLabelText('运行中')).toBeNull();
    expect(screen.getByText('plain')).toBeTruthy();
  });

  it('Stopped phase forces idle even while typing', () => {
    useTypingStore.getState().setTypingUsers(ROOM, [{ userId: MXID, displayName: 'w1' }]);
    render(<WorkerSessionName worker={{ ...WORKER, phase: 'Stopped' }} />);
    expect(screen.getByLabelText('无任务')).toBeTruthy();
  });

  it('Running phase keeps typing → running', () => {
    useTypingStore.getState().setTypingUsers(ROOM, [{ userId: MXID, displayName: 'w1' }]);
    render(<WorkerSessionName worker={{ ...WORKER, phase: 'Running' }} />);
    expect(screen.getByLabelText('运行中')).toBeTruthy();
  });
});
