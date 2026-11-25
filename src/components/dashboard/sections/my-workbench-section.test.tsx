import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MyWorkbenchSection } from './my-workbench-section';
import { useInviteStore } from '@/lib/matrix-invite-store';
import { useSectionStore } from '@/lib/section-store';
import { useRoomMetaStore } from '@/hooks/use-matrix';

vi.mock('./welcome-steps', () => ({ WelcomeSteps: () => null }));
afterEach(() => { cleanup(); useInviteStore.getState().clear(); useRoomMetaStore.setState({ meta: {} }); });

it('shows every mentioned room counted by the banner and opens the mention itself', () => {
  useRoomMetaStore.setState({ meta: Object.fromEntries(Array.from({ length: 10 }, (_, i) => [`!room-${i}:test`, { roomName: `Room ${i}`, unreadHighlightCount: 1, updatedAt: 1 }])) });
  render(<MyWorkbenchSection />);
  expect(screen.getByText('@我的消息（10 个房间）')).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: /Room 9/ }));
  expect(useSectionStore.getState().mentionRoomId).toBe('!room-9:test');
});

it('opens the team invitation inbox instead of an inaccessible assistant room', () => {
  useSectionStore.setState({ activeSection: 'my-workbench' });
  useInviteStore.getState().upsertInvite({ roomId: '!new-task:test', sender: '@leader:test', roomName: '新任务' });
  render(<MyWorkbenchSection />);
  fireEvent.click(screen.getByRole('button', { name: /房间邀请/ }));
  expect(useSectionStore.getState().activeSection).toBe('my-teams');
  expect(useInviteStore.getState().pendingInboxJump).toBe(true);
});
