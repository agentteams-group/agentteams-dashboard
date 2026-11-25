import { afterEach, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { SESSION_RECEIPT_TYPE } from '@/lib/message-read-status';
import { GET } from './route';

afterEach(() => vi.restoreAllMocks());

it('keeps messages visible when later receipt metadata fills a history page', async () => {
  const message = { type: 'm.room.message', event_id: '$message', content: { body: 'hello' } };
  const events = [
    ...Array.from({ length: 60 }, (_, i) => ({ type: SESSION_RECEIPT_TYPE, event_id: `$receipt-${i}`, content: {} })),
    message,
  ];
  const upstream = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) => {
    const query = new URL(String(input)).searchParams;
    const filter = JSON.parse(query.get('filter') || '{}');
    const visible = events.filter(event => !filter.not_types?.includes(event.type));
    return Response.json({ chunk: visible.slice(0, Number(query.get('limit'))), start: 'start', end: 'older' });
  });
  const request = new NextRequest('http://dashboard.test/api/matrix/rooms/r/messages?homeserver=http%3A%2F%2F127.0.0.1%3A6167&limit=50&from=older%2Fcursor', {
    headers: { Authorization: 'Bearer test-token' },
  });
  const response = await GET(request, { params: Promise.resolve({ roomId: '!room:test' }) });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ chunk: [message], start: 'start', end: 'older' });
  const query = new URL(String(upstream.mock.calls[0][0])).searchParams;
  expect(query.get('from')).toBe('older/cursor');
  expect(query.get('dir')).toBe('b');
});
