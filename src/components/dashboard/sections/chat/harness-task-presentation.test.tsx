import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatMatrixEvents } from '@/hooks/use-matrix';
import { assembleChatTimeline } from '@/lib/chat-ir/assemble';
import type { WorkerRuntime } from '@/lib/agentteams-api';
import type { MatrixEvent } from '@/lib/matrix-api';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { buildGroupedMessages } from './grouper/MainGrouper';
import { MessageBubble } from './views/MessageBubble';

vi.mock('./markdown-message', () => ({ MarkdownMessage: ({ content }: { content: string }) => <div>{content}</div> }));

const harnesses: WorkerRuntime[] = ['openclaw', 'qwenpaw', 'hermes', 'deepseek-harness', 'openhuman', 'codex'];
const sender = '@worker:server';
function event(id: string, body: string, extra: Record<string, unknown> = {}): MatrixEvent {
  return { event_id: id, sender, type: 'm.room.message', origin_server_ts: 1_700_000_000_000,
    content: { msgtype: 'm.text', body, ...extra } } as MatrixEvent;
}
function messages(events: MatrixEvent[], runtime: WorkerRuntime) {
  return assembleChatTimeline(formatMatrixEvents(events, '@me:server'), events, {
    currentUserId: '@me:server', runtimeMap: { [sender]: { runtime, workerName: 'worker' } },
    now: 1_700_000_001_000,
  }).messages;
}
function view(events: MatrixEvent[], runtime: WorkerRuntime, onSendConfirmation = vi.fn()) {
  return <QueryClientProvider client={new QueryClient()}>
    {messages(events, runtime).map(message => <MessageBubble key={message.id} message={message} showSender isContinuation={false} onSendConfirmation={onSendConfirmation} />)}
  </QueryClientProvider>;
}

beforeEach(() => useHitlInboxStore.setState({ confirmations: {}, resolutions: {} }));
afterEach(cleanup);

it('shows independent threads from the same Agent as separate replies', () => {
  const thread = (root: string) => ({ 'm.relates_to': { rel_type: 'm.thread', event_id: root } });
  const final = (root: string, body: string) => ({
    'm.relates_to': { rel_type: 'm.replace', event_id: root },
    'm.new_content': { msgtype: 'm.text', body },
  });
  const events = [
    event('$first', '处理中...', { msgtype: 'm.notice' }),
    event('$second', '处理中...', { msgtype: 'm.notice' }),
    event('$think-first', 'Thinking:\n\n第一轮思考', { msgtype: 'm.notice', ...thread('$first') }),
    event('$think-second', 'Thinking:\n\n第二轮思考', { msgtype: 'm.notice', ...thread('$second') }),
    event('$reply-first', '第一轮回复', final('$first', '第一轮回复')),
    event('$reply-second', '第二轮回复', final('$second', '第二轮回复')),
  ].map((item, index) => ({ ...item, origin_server_ts: item.origin_server_ts + index }));
  const grouped = buildGroupedMessages(messages(events, 'qwenpaw'));
  expect(grouped.map(({ message, showSender, isContinuation }) => [message.content, showSender, isContinuation]))
    .toEqual([['第一轮回复', true, false], ['第二轮回复', true, false]]);
  expect(grouped.map(({ message }) => message.precomputedBlocks?.[0])).toMatchObject([
    { type: 'thinking', content: '第一轮思考' },
    { type: 'thinking', content: '第二轮思考' },
  ]);

  const humanEvents = [
    { ...event('$human-first', '你好'), sender: '@me:server' },
    { ...event('$human-second', '请看一下'), sender: '@me:server' },
  ];
  expect(buildGroupedMessages(messages(humanEvents, 'qwenpaw')).map(({ isContinuation }) => isContinuation))
    .toEqual([false, true]);
});

describe.each(harnesses)('%s task presentation through Matrix and ChatIR', runtime => {
  it('keeps task notifications separate from the answer and folds transport details', () => {
    const bodies = [
      '[ProjectFlow] create_project + plan_dag: 项目「网站改版」（projectId=p-01）已创建，room=!private:server',
      '@worker:server You are assigned task **p-01**: 首页设计\nInternal specification',
      '@lead:server TASK_COMPLETED: p-01 - Result: shared/tasks/p-01/result.md',
      '@lead:server TASK_BLOCKED: p-02 - 数据库连接失败',
      '@worker:server 📎 已发布 result.zip（52 KB）— shared/tasks/p-01/result.zip',
    ];
    const events = [event('$answer', '我会继续跟进执行情况。'), ...bodies.map((body, index) => event('$notice-' + index, body))];
    expect(messages(events, runtime).map(message => message.id)).toEqual(events.map(item => item.event_id));
    render(view(events, runtime));
    expect(screen.getByText('我会继续跟进执行情况。')).toBeVisible();
    for (const title of ['项目已启动', '任务已分配', '任务已提交', '任务已阻塞', '交付文件已更新']) {
      expect(screen.getByRole('note', { name: title })).toBeVisible();
    }
    expect(screen.getByText('等待验收')).toBeVisible();
    expect(screen.getByText('数据库连接失败')).toBeVisible();
    for (const body of bodies) expect(screen.getByText(body, { normalizer: value => value })).not.toBeVisible();
    fireEvent.click(screen.getAllByText('原始通知')[0]);
    expect(screen.getByText(bodies[0])).toBeVisible();
  });

  it('preserves a structured approval even when its fallback body resembles a notification', () => {
    const onSend = vi.fn().mockResolvedValue(true);
    render(view([event('$approval', '[ProjectFlow] delegate_task: 项目「网站改版」', {
      'org.agentteams.run': { version: '1', blocks: [{ type: 'confirmation', tool_name: 'bash', confirmation_id: 'cfm-1', approve_reply: 'yes', reject_reply: 'no' }] },
    })], runtime, onSend));
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByRole('button', { name: '批准本次' })).toBeVisible();
    expect(screen.getByRole('button', { name: '拒绝本次' })).toBeVisible();
    expect(onSend).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '批准本次' }));
    expect(onSend).toHaveBeenCalledTimes(1);
  });

  it('preserves a downloadable attachment behind a notification fallback body', () => {
    render(view([event('$file', '[ProjectFlow] delegate_task: 项目「网站改版」', {
      'com.agentteams.long_message': { version: 1, url: 'mxc://server/media-id', filename: 'full-reply.txt', mimetype: 'text/plain' },
    })], runtime));
    expect(screen.queryByRole('note')).toBeNull();
    expect(screen.getByText('full-reply.txt')).toBeVisible();
  });
});
