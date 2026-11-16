import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { openChatRoom } from './open-chat-room';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useSectionStore } from '@/lib/section-store';

beforeEach(() => {
  useHitlInboxStore.setState({ confirmations: {}, pendingChatRoomId: null, pendingProjectKey: null });
  useSectionStore.setState({ activeSection: 'workers' });
});

afterEach(() => {
  useHitlInboxStore.setState({ confirmations: {}, pendingChatRoomId: null, pendingProjectKey: null });
  useSectionStore.setState({ activeSection: 'workers' });
});

describe('openChatRoom', () => {
  it('keeps task collaboration context and clears it when opening another conversation', () => {
    openChatRoom('!execution:matrix', 'task-123');
    expect(useSectionStore.getState().taskCollaboration).toEqual({ taskId: 'task-123', roomId: '!execution:matrix' });
    openChatRoom('!source:matrix');
    expect(useSectionStore.getState().taskCollaboration).toBeNull();
  });
  it('writes pendingChatRoomId and switches the active section to chat', () => {
    openChatRoom('!r1:matrix');
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!r1:matrix');
    expect(useSectionStore.getState().activeSection).toBe('chat');
  });

  it('ignores empty or nullish room ids', () => {
    useSectionStore.setState({ activeSection: 'overview' });
    openChatRoom('');
    openChatRoom(null);
    openChatRoom(undefined);
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBeNull();
    expect(useSectionStore.getState().activeSection).toBe('overview');
  });

  it('overrides a previous pending room id', () => {
    openChatRoom('!old:matrix');
    openChatRoom('!new:matrix');
    expect(useHitlInboxStore.getState().pendingChatRoomId).toBe('!new:matrix');
  });
});
