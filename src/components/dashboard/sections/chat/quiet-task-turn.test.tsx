import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { formatMatrixEvents } from '@/hooks/use-matrix';
import { assembleChatTimeline, NO_ANSWER_STALE_MS } from '@/lib/chat-ir/assemble';
import type { MatrixEvent } from '@/lib/matrix-api';
import { MessageBubble } from './views/MessageBubble';
import { markStoppedMessages } from '@/lib/direct-execution';

vi.mock('./lazy-markdown-message', async () => {
  const { MarkdownMessage } = await import('./markdown-message');
  return { LazyMarkdownMessage: MarkdownMessage };
});
vi.mock('./markdown-message', () => ({ MarkdownMessage: ({ content }: { content: string }) => <div>{content}</div> }));
afterEach(cleanup);

it('renders the completed planning tool and downstream handoff without empty or interrupted bubbles', () => {
  const ts = 1_700_000_000_000;
  const sender = '@leader:server';
  const events = [
    { event_id: '$execution', content: { msgtype: 'm.notice', body: '正在处理，你可以继续补充信息或停止执行。',
      'org.agentteams.progress_only': true,
      'com.agentteams.execution': { run_id: '$source', status: 'running', capabilities: ['stop', 'steer'] } } },
    { event_id: '$root', content: { msgtype: 'm.notice', body: '处理中...' } },
    { event_id: '$tool', content: { msgtype: 'm.text', body: '🔧 **teamharness__task**\n```json\n{"action":"plan"}\n```',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root' } } },
    { event_id: '$handoff', content: { msgtype: 'm.text', body: '@developer 请开始实现' } },
    { event_id: '$quiet', content: { msgtype: 'm.notice', body: '* 已处理',
      'm.relates_to': { rel_type: 'm.replace', event_id: '$root' },
      'm.new_content': { msgtype: 'm.notice', body: '已处理' } } },
  ].map((event, index) => ({ ...event, sender, type: 'm.room.message', origin_server_ts: ts + index * 1000 })) as MatrixEvent[];
  const { messages } = assembleChatTimeline(formatMatrixEvents(events, '@human:server'), events, {
    currentUserId: '@human:server', runtimeMap: { [sender]: { runtime: 'qwenpaw', workerName: 'leader' } },
    now: ts + NO_ANSWER_STALE_MS + 10_000,
  });
  expect(markStoppedMessages(messages, events, [sender]).map(message => message.id)).toEqual(messages.map(message => message.id));
  render(<QueryClientProvider client={new QueryClient()}>
    {messages.map(message => <MessageBubble key={message.id} message={message} showSender isContinuation={false} />)}
  </QueryClientProvider>);
  expect(screen.getAllByTestId('run-process')).toHaveLength(1);
  expect(screen.getByTestId('run-process')).toHaveAttribute('data-state', 'closed');
  expect(screen.getByText('工具 1')).toBeVisible();
  expect(screen.getByText('@developer 请开始实现')).toBeVisible();
  expect(screen.queryByText('本轮未生成最终答复')).toBeNull();
  expect(screen.queryByText('已处理（无回复）')).toBeNull();
  expect(screen.queryByText('正在处理，你可以继续补充信息或停止执行。')).toBeNull();
  fireEvent.click(screen.getByRole('button', { name: /过程/ }));
  expect(screen.getByText('teamharness__task')).toBeVisible();
});
