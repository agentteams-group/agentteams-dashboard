import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { createRef, forwardRef, useImperativeHandle } from 'react';
import type { ForwardedRef, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GroupedMessage } from '../grouper/MainGrouper';
import { TimelinePanel, type TimelineItem } from './TimelinePanel';
import type { ScrollPanelHandle } from './ScrollPanel';

const virtuosoMock = vi.hoisted(() => ({
  scrollToIndex: vi.fn(),
  props: null as Record<string, unknown> | null,
}));

vi.mock('react-virtuoso', () => ({
  Virtuoso: forwardRef(function VirtuosoMock(
    props: Record<string, unknown>,
    ref: ForwardedRef<{ scrollToIndex: typeof virtuosoMock.scrollToIndex }>
  ) {
    virtuosoMock.props = props;
    useImperativeHandle(ref, () => ({ scrollToIndex: virtuosoMock.scrollToIndex }));
    const data = props.data as unknown as TimelineItem[];
    const itemContent = props.itemContent as (_index: number, _item: unknown) => ReactNode;
    return (
      <div data-testid="virtuoso">
        {data.map((item, index) => itemContent(index, item))}
      </div>
    );
  }),
}));

function message(id: string, eventId?: string): GroupedMessage {
  return {
    message: {
      id,
      eventId,
      sender: '@user:example.com',
      senderShort: 'user',
      content: id,
      timestamp: 0,
      type: 'm.text',
      isMe: false,
    },
    showSender: true,
    isContinuation: false,
  };
}

function renderPanel(items: GroupedMessage[], readEventId?: string | null) {
  return render(
    <TimelinePanel
      ref={createRef<ScrollPanelHandle>()}
      items={items}
      readEventId={readEventId}
      itemContent={(_index, item) => <span>{item.message.content}</span>}
      hasNextPage={false}
      isFetchingNextPage={false}
      onLoadMore={() => {}}
    />
  );
}

describe('TimelinePanel', () => {
  afterEach(() => {
    cleanup();
    virtuosoMock.scrollToIndex.mockReset();
    virtuosoMock.props = null;
  });

  it('renders messages in order when there is no read anchor', () => {
    renderPanel([message('a'), message('b')], null);

    const text = screen.getAllByRole('generic').map((el) => el.textContent).join(' ');
    expect(text).toContain('a');
    expect(text).toContain('b');
    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('anchors the unread divider after the read marker event and shows the unread count', () => {
    renderPanel([message('a'), message('b', '$b'), message('c')], '$b');

    const separator = screen.getByRole('separator');
    // The divider sits between b and c: the timeline order is a, b, divider, c.
    const bubbles = Array.from(screen.getAllByText(/^[abc]$/));
    expect(separator).toBeInTheDocument();
    expect(separator.textContent).toContain('未读消息');
    expect(separator.textContent).toContain('1');
    // a and b come before the divider, c after it.
    expect(bubbles.length).toBe(3);
  });

  it('renders no divider when the anchor is the latest message', () => {
    renderPanel([message('a'), message('b'), message('c', '$c')], '$c');

    expect(screen.queryByRole('separator')).toBeNull();
  });

  it('counts every message after the anchor in the divider label', () => {
    renderPanel([message('a', '$a'), message('b'), message('c'), message('d')], '$a');

    const separator = screen.getByRole('separator');
    expect(separator.textContent).toContain('3');
  });

  it('lands on the divider instead of the latest message when unread exists', () => {
    renderPanel([message('a', '$a'), message('b')], '$a');

    // The initial mount scrolls to the divider index (1), not the last item.
    expect(virtuosoMock.scrollToIndex).toHaveBeenCalledWith({ index: 1, align: 'start' });
  });

  it('lands on the latest message when the anchor equals the latest message', () => {
    renderPanel([message('a'), message('b', '$b')], '$b');

    expect(virtuosoMock.scrollToIndex).toHaveBeenCalledWith({ index: 1, align: 'end' });
  });

  it('exposes scrollToItem to locate a read-marker divider by key', () => {
    const ref = createRef<ScrollPanelHandle>();
    render(
      <TimelinePanel
        ref={ref}
        items={[message('a', '$a'), message('b')]}
        readEventId="$a"
        itemContent={(_index, item) => <span>{item.message.content}</span>}
        hasNextPage={false}
        isFetchingNextPage={false}
        onLoadMore={() => {}}
      />
    );

    act(() => ref.current?.scrollToItem('read-marker-$a'));

    expect(virtuosoMock.scrollToIndex).toHaveBeenCalledWith({
      index: 1,
      align: 'center',
      behavior: 'smooth',
    });
  });
});
