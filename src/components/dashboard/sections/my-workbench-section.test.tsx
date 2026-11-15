import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MyWorkbenchSection } from './my-workbench-section';
import { useInviteStore } from '@/lib/matrix-invite-store';
import { useSectionStore } from '@/lib/section-store';

vi.mock('./welcome-steps', () => ({ WelcomeSteps: () => null }));
afterEach(() => { cleanup(); useInviteStore.getState().clear(); });

it('opens the team invitation inbox instead of an inaccessible assistant room', () => {
  useSectionStore.setState({ activeSection: 'my-workbench' });
  useInviteStore.getState().upsertInvite({ roomId: '!new-task:test', sender: '@leader:test', roomName: '新任务' });
  render(<MyWorkbenchSection />);
  fireEvent.click(screen.getByRole('button', { name: /房间邀请/ }));
  expect(useSectionStore.getState().activeSection).toBe('my-teams');
  expect(useInviteStore.getState().pendingInboxJump).toBe(true);
});
