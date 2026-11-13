import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MessageReadRoomContext, MessageReadStatus } from './message-read-status';
import { READ_AUDIENCE_KEY, SESSION_RECEIPT_TYPE, messageReadStatusKey } from '@/lib/message-read-status';
import { useMatrixStore } from '@/lib/matrix-store';
import { useReceiptStore, type DisplayMessage } from '@/hooks/use-matrix';

const message: DisplayMessage = {
  id: '$m', eventId: '$m', sender: '@me:hs', senderShort: '我', content: '请检查结果', timestamp: 100, type: 'm.text', isMe: true,
  rawContent: { [READ_AUDIENCE_KEY]: { version: 1, members: [
    { user_id: '@a:hs', display_name: 'Alice', kind: 'agent' },
    { user_id: '@b:hs', display_name: 'Bob', kind: 'agent' },
    { user_id: '@old:hs', display_name: '旧 Agent', kind: 'agent' },
  ] } },
};

function show(input = message, evidence = [
  { event_id: '$r1', sender: '@a:hs', type: SESSION_RECEIPT_TYPE, origin_server_ts: 200, content: { version: 1, status: 'read', 'm.relates_to': { rel_type: SESSION_RECEIPT_TYPE, event_id: '$m' } } },
  { event_id: '$r2', sender: '@b:hs', type: SESSION_RECEIPT_TYPE, origin_server_ts: 201, content: { version: 1, status: 'received', 'm.relates_to': { rel_type: SESSION_RECEIPT_TYPE, event_id: '$m' } } },
]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  client.setQueryData(messageReadStatusKey('http://matrix.test', '@me:hs', '!room:hs', '$m'), evidence);
  return render(<QueryClientProvider client={client}><MessageReadRoomContext.Provider value="!room:hs"><MessageReadStatus message={input} /></MessageReadRoomContext.Provider></QueryClientProvider>);
}

beforeEach(() => {
  useMatrixStore.setState({ homeserver: 'http://matrix.test', accessToken: 'token', userId: '@me:hs', isLoggedIn: true });
  useReceiptStore.setState({ receipts: {} });
});
afterEach(cleanup);

describe('message read interaction', () => {
  it('opens separate read/unread lists and omits unsupported members', () => {
    show();
    fireEvent.click(screen.getByRole('button', { name: '消息阅读状态：已读 1 · 未读 1' }));
    expect(screen.getByRole('region', { name: '已读成员' })).toHaveTextContent('Alice');
    expect(screen.getByRole('region', { name: '未读成员' })).toHaveTextContent('Bob');
    expect(screen.queryByText('旧 Agent')).not.toBeInTheDocument();
    expect(screen.queryByText('状态未知')).not.toBeInTheDocument();
  });

  it('only shows mentioned members', () => {
    show({ ...message, rawContent: { ...message.rawContent, 'm.mentions': { user_ids: ['@b:hs'] } } });
    fireEvent.click(screen.getByRole('button', { name: '消息阅读状态：Bob 未读' }));
    expect(screen.queryByText('Alice')).not.toBeInTheDocument();
    expect(screen.getByText('Bob')).toBeInTheDocument();
  });

  it('renders no status entry when no Agent supports confirmation', () => {
    const { container } = show(message, []);
    expect(container).toBeEmptyDOMElement();
  });
});
