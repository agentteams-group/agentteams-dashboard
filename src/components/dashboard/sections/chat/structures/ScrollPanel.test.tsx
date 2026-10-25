import { act, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { createRef, forwardRef, useImperativeHandle } from 'react';
import type { ForwardedRef, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { GroupedMessage } from '../grouper/MainGrouper';
import { ScrollPanel, type ScrollPanelHandle } from './ScrollPanel';

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
    const data = props.data as GroupedMessage[];
    const itemContent = props.itemContent as (_index: number, _item: GroupedMessage) => ReactNode;
    // Mirror Virtuoso: itemContent indices live in the shifted space.
    const firstItemIndex = (props.firstItemIndex as number | undefined) ?? 0;
    return (
      <div data-testid="virtuoso">
        {data.map((item, index) => itemContent(index + firstItemIndex, item))}
      </div>
    );
  }),
}));

function message(id: string): GroupedMessage {
  return {
    message: {
      id,
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

describe('ScrollPanel', () => {
  afterEach(() => {
    vi.useRealTimers();
    virtuosoMock.scrollToIndex.mockReset();
    virtuosoMock.props = null;
  });

  it('centers a requested item and announces a temporary highlight', () => {
    vi.useFakeTimers();
    const ref = createRef<ScrollPanelHandle>();
    render(
      <ScrollPanel
        ref={ref}
        items={[message('first'), message('second')]}
        itemContent={(_index, item) => <span>{item.message.content}</span>}
        hasNextPage={false}
        isFetchingNextPage={false}
        onLoadMore={() => {}}
      />
    );

    act(() => ref.current?.scrollToIndex(1));

    expect(virtuosoMock.scrollToIndex).toHaveBeenCalledWith({
      index: 1,
      align: 'center',
      behavior: 'smooth',
    });
    expect(screen.getByText('second').parentElement).toHaveClass('bg-primary/10');
    expect(screen.getByText('second').parentElement).toHaveAttribute('data-timeline-index', '1');
    expect(screen.getByText('已定位到第 2 条消息')).toBeInTheDocument();

    act(() => vi.advanceTimersByTime(1800));
    expect(screen.getByText('second').parentElement).not.toHaveClass('bg-primary/10');
  });

  it('requests older messages from the top edge and reports bottom state changes', () => {
    const onLoadMore = vi.fn();
    const onAtBottomChange = vi.fn();
    render(
      <ScrollPanel
        items={[message('only')]}
        itemContent={(_index, item) => <span>{item.message.content}</span>}
        hasNextPage
        isFetchingNextPage={false}
        onLoadMore={onLoadMore}
        onAtBottomChange={onAtBottomChange}
      />
    );

    const props = virtuosoMock.props as {
      atBottomStateChange: (_atBottom: boolean) => void;
      startReached: () => void;
    };
    act(() => props.atBottomStateChange(false));
    act(() => props.startReached());

    expect(onAtBottomChange).toHaveBeenCalledWith(false);
    expect(onLoadMore).toHaveBeenCalledOnce();
  });

  it('does not request another page while a top-edge request is pending', () => {
    const onLoadMore = vi.fn();
    render(
      <ScrollPanel
        items={[message('only')]}
        itemContent={(_index, item) => <span>{item.message.content}</span>}
        hasNextPage
        isFetchingNextPage
        onLoadMore={onLoadMore}
      />
    );

    const props = virtuosoMock.props as { startReached: () => void };
    act(() => props.startReached());

    expect(onLoadMore).not.toHaveBeenCalled();
  });

  it('shifts firstItemIndex when older pages are prepended and keeps it on append', () => {
    const itemContent = (_index: number, item: GroupedMessage) => (
      <span>{item.message.content}</span>
    );
    const props = () =>
      virtuosoMock.props as { firstItemIndex: number };
    const view = render(
      <ScrollPanel
        items={[message('b'), message('c')]}
        itemContent={itemContent}
        hasNextPage
        isFetchingNextPage={false}
        onLoadMore={() => {}}
      />
    );
    const initialFirst = props().firstItemIndex;

    view.rerender(
      <ScrollPanel
        items={[message('a'), message('b'), message('c')]}
        itemContent={itemContent}
        hasNextPage
        isFetchingNextPage={false}
        onLoadMore={() => {}}
      />
    );
    const prependedFirst = props().firstItemIndex;
    expect(prependedFirst).toBe(initialFirst - 1);

    view.rerender(
      <ScrollPanel
        items={[message('a'), message('b'), message('c'), message('d')]}
        itemContent={itemContent}
        hasNextPage
        isFetchingNextPage={false}
        onLoadMore={() => {}}
      />
    );
    expect(props().firstItemIndex).toBe(prependedFirst);
  });

  it('follows new messages only while the scroller is at the bottom', () => {
    render(
      <ScrollPanel
        items={[message('only')]}
        itemContent={(_index, item) => <span>{item.message.content}</span>}
        hasNextPage={false}
        isFetchingNextPage={false}
        onLoadMore={() => {}}
      />
    );

    const followOutput = (virtuosoMock.props as {
      followOutput: (_atBottom: boolean) => unknown;
    }).followOutput;

    expect(followOutput(true)).toBe('auto');
    expect(followOutput(false)).toBe(false);
  });
});
