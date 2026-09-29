import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { ChatRoomSidebar } from './sections/chat/chat-room-sidebar';

describe('ChatRoomSidebar resize listener cleanup', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    cleanup();
  });

  it('removes window listeners when the sidebar unmounts mid-drag', () => {
    const added: Array<{ type: string; listener: EventListener }> = [];
    const removed: Array<{ type: string; listener: EventListener }> = [];
    vi.spyOn(window, 'addEventListener').mockImplementation(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        added.push({ type, listener: listener as EventListener });
      }
    );
    vi.spyOn(window, 'removeEventListener').mockImplementation(
      (type: string, listener: EventListenerOrEventListenerObject) => {
        removed.push({ type, listener: listener as EventListener });
      }
    );

    const { getByRole, unmount } = render(
      <ChatRoomSidebar
        rooms={[]}
        selectedRoomId={null}
        onSelectRoom={vi.fn()}
        isLoggedIn={false}
        userId={null}
        isLoading={false}
        onCollapse={vi.fn()}
      />
    );

    fireEvent.pointerDown(getByRole('separator'), { clientX: 240, button: 0 });
    const move = added.find((e) => e.type === 'pointermove');
    const up = added.find((e) => e.type === 'pointerup');
    expect(move).toBeTruthy();
    expect(up).toBeTruthy();

    unmount();

    expect(
      removed.some((e) => e.type === 'pointermove' && e.listener === move?.listener)
    ).toBe(true);
    expect(
      removed.some((e) => e.type === 'pointerup' && e.listener === up?.listener)
    ).toBe(true);
  });
});
