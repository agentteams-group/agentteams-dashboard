import { act, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { createRef } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GroupedMessage } from '../grouper/MainGrouper';
import { TimelineRail, type TimelineRailHandle } from './TimelineRail';

afterEach(() => {
  document.body.innerHTML = '';
});

function item(id: string, minute: number): GroupedMessage {
  return {
    message: {
      id,
      sender: '@worker:example.com',
      senderShort: 'worker',
      content: id,
      timestamp: new Date(2026, 9, 26, 10, minute).getTime(),
      type: 'm.text',
      isMe: false,
    },
    showSender: true,
    isContinuation: false,
  };
}

function items(count: number): GroupedMessage[] {
  return Array.from({ length: count }, (_entry, index) => item(`$${index}`, index));
}

function readMarker(): GroupedMessage {
  return { kind: 'read-marker', key: 'read-marker-$1', unreadCount: 3 } as unknown as GroupedMessage;
}

describe('TimelineRail', () => {
  it('stays hidden for a short conversation', () => {
    render(<TimelineRail items={items(5)} onJump={() => {}} />);
    expect(screen.queryByTestId('timeline-rail')).toBeNull();
  });

  it('renders one dash per message and jumps to it on click', () => {
    const onJump = vi.fn();
    render(<TimelineRail items={items(8)} onJump={onJump} />);

    expect(screen.getAllByTestId(/^rail-tick-/)).toHaveLength(8);
    fireEvent.click(screen.getByTestId('rail-tick-5'));
    expect(onJump).toHaveBeenCalledWith(5);
  });

  it('buckets long rooms so the dash count stays bounded', () => {
    const onJump = vi.fn();
    render(<TimelineRail items={items(500)} onJump={onJump} />);

    const ticks = screen.getAllByTestId(/^rail-tick-/);
    // ceil(500 / 40) = 13 messages per dash → 39 dashes, none past the end.
    expect(ticks).toHaveLength(39);
    expect(ticks[0]).toHaveAccessibleName('worker · 10:00（13 条）');
    expect(ticks[38]).toHaveAccessibleName('worker · 18:14（6 条）');

    fireEvent.click(ticks[38]);
    expect(onJump).toHaveBeenCalledWith(494);
  });

  it('widens the dashes covering the reported viewport range', () => {
    const ref = createRef<TimelineRailHandle>();
    render(<TimelineRail ref={ref} items={items(10)} onJump={() => {}} />);

    expect(screen.getByTestId('rail-tick-4')).toHaveClass('w-1.5');
    act(() => ref.current?.setRange(3, 5));

    expect(screen.getByTestId('rail-tick-3')).toHaveClass('w-3');
    expect(screen.getByTestId('rail-tick-5')).toHaveClass('w-3');
    expect(screen.getByTestId('rail-tick-6')).toHaveClass('w-1.5');
  });

  it('marks the dash that holds the unread divider', () => {
    const withMarker = items(8);
    withMarker.splice(2, 0, readMarker());
    render(<TimelineRail items={withMarker} onJump={() => {}} />);

    const unread = screen.getByTestId('rail-tick-2');
    expect(unread).toHaveAccessibleName('未读消息');
    expect(unread).toHaveClass('bg-primary/45');
  });
});
