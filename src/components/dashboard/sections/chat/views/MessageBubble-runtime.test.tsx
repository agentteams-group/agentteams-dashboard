import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { TooltipProvider } from '@/components/ui/tooltip';
import { MessageBubble } from './MessageBubble';
import { clearToolCallLedger, countToolCalls24h } from '@/lib/tool-call-counter';
import type { DisplayMessage } from '@/hooks/use-matrix';

const markdownMock = vi.fn(({ content }: { content: string }) => <div>{content}</div>);
vi.mock('../markdown-message', () => ({
  MarkdownMessage: (props: { content: string }) => markdownMock(props),
}));

afterEach(() => {
  cleanup();
  clearToolCallLedger();
});

function makeMessage(overrides: Partial<DisplayMessage>): DisplayMessage {
  return {
    id: '$m1',
    sender: '@w-qwenpaw:server',
    senderShort: 'w-qwenpaw',
    content: '',
    timestamp: 0,
    type: 'm.text',
    isMe: false,
    rawContent: { msgtype: 'm.text' },
    ...overrides,
  };
}

function renderBubble(message: DisplayMessage) {
  return render(
    <TooltipProvider>
      <MessageBubble message={message} showSender={false} isContinuation={false} />
    </TooltipProvider>,
  );
}

/** Finished runs start folded; open the process disclosure before inner assertions. */
function expandProcess() {
  fireEvent.click(screen.getByRole('button', { name: /^过程/ }));
}

describe('MessageBubble runtime badges (AC-C7)', () => {
  it('badges a qwenpaw thinking card with the runtime and titles it', () => {
    renderBubble(
      makeMessage({
        content: 'Thinking:\n\n先拆解需求',
        runtime: 'qwenpaw',
        rawContent: { msgtype: 'm.notice' },
      }),
    );
    expect(screen.getByTestId('run-process')).toHaveAttribute('data-state', 'closed');
    expandProcess();
    expect(screen.getByText('QwenPaw · 思考过程')).toBeInTheDocument();
    // One badge on the process header, one on the thinking step.
    expect(screen.getAllByText('QwenPaw').length).toBeGreaterThanOrEqual(2);
  });

  it('keeps the plain title when runtime is unknown', () => {
    renderBubble(makeMessage({ content: 'Thinking:\n\n先拆解需求', rawContent: { msgtype: 'm.notice' } }));
    expandProcess();
    expect(screen.getByText('思考过程')).toBeInTheDocument();
    expect(screen.queryByText('QwenPaw')).toBeNull();
  });

  it('badges tool_call cards with the runtime', () => {
    renderBubble(
      makeMessage({
        content: '🔧 **web_search**\n```json\n{"query":"状态"}\n```',
        runtime: 'hermes',
      }),
    );
    expandProcess();
    expect(screen.getByRole('button', { name: /网页搜索/ })).toHaveTextContent('Hermes');
  });

  it('marks keyword-heuristic tool calls as low confidence', () => {
    renderBubble(
      makeMessage({
        content: 'tool: web_search',
        runtime: 'hermes',
        rawContent: { msgtype: 'm.notice' },
      }),
    );
    // A heuristic `running` guess must not force the finished fold open.
    expect(screen.getByTestId('run-process')).toHaveAttribute('data-state', 'closed');
    expandProcess();
    expect(screen.getByLabelText('识别置信度低')).toBeInTheDocument();
  });

  it('keeps the event id behind the debug affordance with the full id and revision count', () => {
    renderBubble(
      makeMessage({
        content: 'Thinking:\n\n先拆解需求',
        runtime: 'qwenpaw',
        rawContent: { msgtype: 'm.notice' },
        eventId: '$root-event-id-1234567890',
        revisionCount: 2,
      }),
    );
    expandProcess();
    expect(screen.queryByTestId('event-chain-info')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('event-debug-trigger'));
    expect(screen.getByTestId('event-chain-info')).toHaveTextContent('$root-event-id-1234567890');
    expect(screen.getByText('编辑 2 次')).toBeInTheDocument();
  });
});

describe('MessageBubble run-ending states (AC-C6)', () => {
  it('renders 已取消 as a warning strip', () => {
    renderBubble(makeMessage({ content: '已取消' }));
    expect(screen.getByTestId('run-ending-cancelled')).toHaveTextContent('任务已取消');
  });

  it('renders 处理异常 as a danger strip', () => {
    renderBubble(makeMessage({ content: '处理异常' }));
    expect(screen.getByTestId('run-ending-failed')).toHaveTextContent('任务异常');
  });

  it('renders 已处理 as a quiet line', () => {
    renderBubble(makeMessage({ content: '已处理' }));
    expect(screen.getByTestId('run-ending-quiet')).toHaveTextContent('已处理（无回复）');
  });

  it('keeps my own 已取消 as a normal text bubble', () => {
    renderBubble(makeMessage({ content: '已取消', isMe: true, sender: '@me:server' }));
    expect(screen.queryByTestId('run-ending-cancelled')).toBeNull();
    expect(screen.getByText('已取消')).toBeInTheDocument();
  });
});

describe('MessageBubble tool-call counting (§6.3)', () => {
  it('records tool_call blocks against the owning worker', () => {
    renderBubble(
      makeMessage({
        content: '🔧 **web_search**\n```json\n{"query":"状态"}\n```',
        eventId: '$evt-tools',
        workerName: 'worker-a',
      }),
    );
    expect(countToolCalls24h('worker-a')).toBe(1);
  });

  it('does not count while the message is still streaming', () => {
    renderBubble(
      makeMessage({
        content: '🔧 **web_search**\n```json\n{"query":"状态"}\n```',
        eventId: '$evt-streaming',
        workerName: 'worker-a',
        isStreaming: true,
      }),
    );
    expect(countToolCalls24h('worker-a')).toBe(0);
  });

  it('skips counting when the sender has no worker mapping', () => {
    renderBubble(
      makeMessage({
        content: '🔧 **web_search**\n```json\n{"query":"状态"}\n```',
        eventId: '$evt-unmapped',
      }),
    );
    expect(countToolCalls24h('worker-a')).toBe(0);
  });
});
