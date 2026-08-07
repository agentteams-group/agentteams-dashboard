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
    return (
      <div data-testid="virtuoso">
        {data.map((item, index) => itemContent(index, item))}
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
});
