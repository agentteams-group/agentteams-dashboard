import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { PUT } from './route';
import { matrixApi } from '@/lib/matrix-api';

describe('Matrix room message send route', () => {
  it('carries a native approval through both the actual client and send proxy', async () => {
    const answer = { kind: 'tool_approval' as const, confirmation_id: 'req-1', context_id: 'ctx-1', agent_id: '@worker:hs', answer: 'approved' };
    let delivered: Record<string, unknown> | undefined;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url, init) => {
      if (String(url).includes('/api/matrix/')) {
        return PUT(new NextRequest(new URL(String(url), 'http://dashboard.test'), {
          method: init?.method, headers: init?.headers, body: String(init?.body),
        }),
          { params: Promise.resolve({ roomId: '!room:test' }) });
      }
      delivered = JSON.parse(init!.body as string);
      return Response.json({ event_id: '$answer' });
    });
    await matrixApi.sendMessage('http://127.0.0.1:6167', 'test-token', '!room:test', '批准本次', {
      'com.agentteams.answer': answer, mentions: { user_ids: ['@worker:hs'] },
    });
    expect(delivered?.['com.agentteams.answer']).toEqual(answer);
    expect(delivered?.['m.mentions']).toEqual({ user_ids: ['@worker:hs'] });
  });

  it.each([
    { kind: 'tool_approval', confirmation_id: 'req-1', context_id: 'ctx-1', agent_id: '@worker:hs', answer: 'approved', actor: '@human:hs' },
    { kind: 'ask_user', confirmation_id: 'question-1', agent_id: '@worker:hs', answer: '选择 A', responses: [{ id: 'q1', selected: ['a'] }] },
  ])('preserves the structured $kind answer sent by the confirmation card', async answer => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ event_id: '$answer' }));
    const request = new NextRequest('http://dashboard.test/api/matrix/rooms/r/send?homeserver=http%3A%2F%2F127.0.0.1%3A6167', {
      method: 'PUT', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '提交本次选择', 'com.agentteams.answer': answer,
        'm.relates_to': { rel_type: 'm.reference', event_id: '$request' } }),
    });
    expect((await PUT(request, { params: Promise.resolve({ roomId: '!room:test' }) })).status).toBe(200);
    const content = JSON.parse(upstream.mock.calls[0][1]!.body as string);
    expect(content['com.agentteams.answer']).toEqual(answer);
    expect(content['m.relates_to']).toEqual({ rel_type: 'm.reference', event_id: '$request' });
  });

  it('rejects a malformed answer before sending a misleading approval message', async () => {
    const upstream = vi.spyOn(globalThis, 'fetch');
    const request = new NextRequest('http://dashboard.test/api/matrix/rooms/r/send?homeserver=http%3A%2F%2F127.0.0.1%3A6167', {
      method: 'PUT', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '批准本次', 'com.agentteams.answer': { answer: 'approved' } }),
    });
    expect((await PUT(request, { params: Promise.resolve({ roomId: '!room:test' }) })).status).toBe(400);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('captures joined members and their identities before sending', async () => {
    const matrixFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ joined: { '@a:hs': { display_name: 'Alice' }, '@me:hs': { display_name: 'Me' } } }))
      .mockResolvedValueOnce(Response.json({ event_id: '$m' }));
    const request = new NextRequest('http://dashboard.test/api/matrix/rooms/r/send?homeserver=http%3A%2F%2F127.0.0.1%3A6167', {
      method: 'PUT', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'hello', track_read_status: true, agent_user_ids: ['@a:hs'], human_user_ids: ['@me:hs'], 'm.mentions': { user_ids: ['@a:hs'] } }),
    });
    const response = await PUT(request, { params: Promise.resolve({ roomId: '!room:test' }) });
    expect(response.status).toBe(200);
    expect(matrixFetch.mock.calls[0][0]).toContain('/joined_members');
    const content = JSON.parse(matrixFetch.mock.calls[1][1]?.body as string);
    expect(content['com.agentteams.read_audience']).toEqual({ version: 1, members: [
      { user_id: '@a:hs', display_name: 'Alice', kind: 'agent' },
      { user_id: '@me:hs', display_name: 'Me', kind: 'human' },
    ] });
    expect(content['m.mentions']).toEqual({ user_ids: ['@a:hs'] });
    expect(content.track_read_status).toBeUndefined();
  });

  it('still sends without a status when the membership snapshot is unavailable', async () => {
    const matrixFetch = vi.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(Response.json({ error: 'unavailable' }, { status: 503 }))
      .mockResolvedValueOnce(Response.json({ event_id: '$m' }));
    const request = new NextRequest('http://dashboard.test/api/matrix/rooms/r/send?homeserver=http%3A%2F%2F127.0.0.1%3A6167', {
      method: 'PUT', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: 'hello', track_read_status: true }),
    });
    expect((await PUT(request, { params: Promise.resolve({ roomId: '!room:test' }) })).status).toBe(200);
    expect(JSON.parse(matrixFetch.mock.calls[1][1]?.body as string)['com.agentteams.read_audience']).toBeUndefined();
  });

  it.each(['stop', 'steer'])('forwards a scoped %s control to the homeserver', async action => {
    const upstream = vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(JSON.stringify({ event_id: '$event' })));
    const control = { action, run_id: '$run', agent_id: '@agent:test' };
    const request = new NextRequest('http://dashboard.test/api/matrix/rooms/room/send?homeserver=http%3A%2F%2F127.0.0.1%3A6167', {
      method: 'PUT', headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: '补充信息', 'com.agentteams.control': control }),
    });
    expect((await PUT(request, { params: Promise.resolve({ roomId: '!room:test' }) })).status).toBe(200);
    expect(JSON.parse(upstream.mock.calls[0][1]!.body as string)['com.agentteams.control']).toEqual(control);
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('forwards Matrix formatted_body used by visible mentions', async () => {
    const matrixFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ event_id: '$event' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const userId = '@smoke-openclaw:matrix-local.agentteams.io:18080';
    const formattedBody = `<a href="https://matrix.to/#/${encodeURIComponent(userId)}">@smoke-openclaw</a> hello`;
    const request = new NextRequest(
      'http://dashboard.test/api/matrix/rooms/room/send?homeserver=http%3A%2F%2F127.0.0.1%3A6167',
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          msgtype: 'm.text',
          body: '@smoke-openclaw hello',
          format: 'org.matrix.custom.html',
          formatted_body: formattedBody,
          'm.mentions': { user_ids: [userId] },
        }),
      }
    );

    const response = await PUT(request, { params: Promise.resolve({ roomId: '!room:test' }) });

    expect(response.status).toBe(200);
    expect(matrixFetch).toHaveBeenCalledOnce();
    const options = matrixFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(options.body as string)).toEqual({
      msgtype: 'm.text',
      body: '@smoke-openclaw hello',
      format: 'org.matrix.custom.html',
      formatted_body: formattedBody,
      'm.mentions': { user_ids: [userId] },
    });
  });

  it('forwards com.agentteams.long_message attachment metadata', async () => {
    const matrixFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ event_id: '$event' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const longMessage = {
      version: 1,
      url: 'mxc://matrix-local.agentteams.io:18080/longmsg-abc',
      filename: 'response-1786420000000.txt',
      mimetype: 'text/plain',
    };
    const request = new NextRequest(
      'http://dashboard.test/api/matrix/rooms/room/send?homeserver=http%3A%2F%2F127.0.0.1%3A6167',
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          msgtype: 'm.text',
          body: '长消息摘要，完整内容见附件',
          'com.agentteams.long_message': longMessage,
        }),
      }
    );

    const response = await PUT(request, { params: Promise.resolve({ roomId: '!room:test' }) });

    expect(response.status).toBe(200);
    const options = matrixFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(options.body as string)).toEqual({
      msgtype: 'm.text',
      body: '长消息摘要，完整内容见附件',
      'com.agentteams.long_message': longMessage,
    });
  });

  it('forwards com.agentteams.file_refs references', async () => {
    const matrixFetch = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ event_id: '$event' }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    );
    const fileRefs = {
      refs: [
        { name: 'report.md', key: 'agents/worker-a/report.md', size: 2048 },
        { name: 'data.csv', key: 'teams/team-a/shared/data.csv' },
      ],
    };
    const request = new NextRequest(
      'http://dashboard.test/api/matrix/rooms/room/send?homeserver=http%3A%2F%2F127.0.0.1%3A6167',
      {
        method: 'PUT',
        headers: {
          Authorization: 'Bearer test-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          msgtype: 'm.text',
          body: '引用 2 个工作空间文件',
          'com.agentteams.file_refs': fileRefs,
        }),
      }
    );

    const response = await PUT(request, { params: Promise.resolve({ roomId: '!room:test' }) });

    expect(response.status).toBe(200);
    const options = matrixFetch.mock.calls[0][1] as RequestInit;
    expect(JSON.parse(options.body as string)).toEqual({
      msgtype: 'm.text',
      body: '引用 2 个工作空间文件',
      'com.agentteams.file_refs': fileRefs,
    });
  });
});
