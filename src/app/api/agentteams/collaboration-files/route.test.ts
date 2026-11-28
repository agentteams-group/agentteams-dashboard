// @vitest-environment node
import { EventEmitter } from 'node:events';
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GET,
  POST,
  CHAT_ATTACHMENT_MAX_BYTES,
  CHAT_ATTACHMENT_TEAM_QUOTA_BYTES,
  CHAT_ATTACHMENT_TENANT_QUOTA_BYTES,
} from './route';

const mock = vi.hoisted(() => ({ proxy: vi.fn(), list: vi.fn(), put: vi.fn(), remove: vi.fn(), saved: Buffer.alloc(0) }));
vi.mock('../proxy-helper', () => ({ getControllerUrl: () => '', proxyToAgentTeams: mock.proxy }));
vi.mock('@/lib/minio-client', () => ({
  getMinioBucket: () => 'bucket',
  createMinioClient: () => ({ listObjects: mock.list, putObject: mock.put, removeObject: mock.remove }),
}));

function request(params: Record<string, string>, user?: string, prefix?: string) {
  const url = new URL('http://localhost/api/agentteams/collaboration-files/');
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  if (!user) return new NextRequest(url);
  url.searchParams.set('prefix', prefix ?? '聊天附件/');
  const form = new FormData();
  form.append('file', new File(['报告'], '报告.md', { type: 'text/markdown' }));
  return new NextRequest(url, { method: 'POST', body: form, headers: { 'x-agentteams-user': user, 'x-agentteams-user-level': '2' } });
}

beforeEach(() => {
  vi.resetAllMocks();
  mock.saved = Buffer.alloc(0);
  mock.put.mockImplementation(async (_bucket, _key, stream: AsyncIterable<Buffer>) => {
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(Buffer.from(chunk));
    mock.saved = Buffer.concat(chunks);
  });
  mock.proxy.mockImplementation((_request, _base, path) => NextResponse.json(path === '/api/v1/tasks'
    ? { tasks: [
      { task_id: 't1', main_task_id: 't1', team_id: '旅行团队', room_id: '!task:test' },
      { task_id: 'child', main_task_id: 't1', team_id: '旅行团队', room_id: '!task:test' },
      { task_id: 'legacy', project_id: 'project1', team_id: '旅行团队' },
      { task_id: 'solo', main_task_id: 'solo', room_id: '!solo:test' },
    ] }
    : path.includes('/workflow')
      ? { project_id: 'project1', tasks_detail: [{ task_id: 'legacy', room_id: '!legacy:test' }] }
      : { teams: [{ name: 'travel', teamName: '旅行团队', admin: { name: 'admin' }, humanMembers: [{ name: 'alice' }] }] }));
  mock.list.mockImplementation((_bucket, prefix) => {
    const stream = new EventEmitter();
    queueMicrotask(() => {
      stream.emit('data', { name: prefix + '报告.md', size: 6 });
      stream.emit('data', { prefix: prefix + '.ssh/' });
      stream.emit('data', { name: 'another/place/other.md', size: 4 });
      stream.emit('end');
    });
    return stream;
  });
});

it('lists only the exact task directory, using the persisted room and storage team name', async () => {
  const response = await GET(request({ room: '!task:test', taskId: 'another-task' }));
  expect(await response.json()).toEqual({
    root: 'teams/旅行团队/shared/tasks/t1/',
    objects: [{ key: '报告.md', size: 6, isPrefix: false }],
  });
  expect(mock.list).toHaveBeenCalledWith('bucket', 'teams/旅行团队/shared/tasks/t1/', false);
});

it('supports legacy task room bindings and standalone tasks with no owning team', async () => {
  expect((await (await GET(request({ room: '!legacy:test', taskId: 'legacy' }))).json()).root).toBe('teams/旅行团队/shared/tasks/legacy/');
  expect((await (await GET(request({ room: '!solo:test' }))).json()).root).toBe('shared/tasks/solo/');
});

it('checks the room binding and rejects paths outside the workspace', async () => {
  expect((await GET(request({ room: '!elsewhere:test', taskId: 'legacy' }))).status).toBe(404);
  expect((await GET(request({ team: 'travel', prefix: '../agents' }))).status).toBe(400);
  expect((await GET(request({ team: 'outsiders' }))).status).toBe(404);
  expect(mock.list).not.toHaveBeenCalled();
});

it('uses the shared root for browsing and restricts member uploads to the attachment folder', async () => {
  const listing = await GET(request({ team: 'travel', prefix: '聊天附件/' }));
  expect((await listing.json()).objects[0].key).toBe('聊天附件/报告.md');
  expect(mock.list).toHaveBeenCalledWith('bucket', 'teams/旅行团队/shared/聊天附件/', false);
  expect((await POST(request({ team: 'travel' }, 'outsider'))).status).toBe(403);
  expect((await POST(request({ team: 'travel' }, 'alice', 'tasks/t1/'))).status).toBe(403);
  expect(mock.put).not.toHaveBeenCalled();
  const saved = await POST(request({ team: 'travel' }, 'alice'));
  expect(saved.status).toBe(200);
  const { key } = await saved.json();
  expect(key).toMatch(/^聊天附件\/[a-f0-9-]+-报告\.md$/);
  expect(mock.put).toHaveBeenCalledWith('bucket', 'teams/旅行团队/shared/' + key, expect.anything(), 6, { 'content-type': 'text/markdown' });
  expect(Buffer.isBuffer(mock.put.mock.calls[0][2])).toBe(false);
  expect(mock.saved).toEqual(Buffer.from('报告'));
});

function multipart(payload: Buffer | string, filename = '报告.md'): Buffer {
  const boundary = '----agentteams-test-boundary';
  return Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: text/markdown\r\n\r\n`),
    Buffer.isBuffer(payload) ? payload : Buffer.from(payload),
    Buffer.from(`\r\n--${boundary}--\r\n`),
  ]);
}

function streamingRequest(body: Buffer, contentLength?: string, chunkSize = 7): NextRequest {
  const url = new URL('http://localhost/api/agentteams/collaboration-files/?team=travel&prefix=%E8%81%8A%E5%A4%A9%E9%99%84%E4%BB%B6%2F');
  let offset = 0;
  const stream = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= body.length) { controller.close(); return; }
      controller.enqueue(new Uint8Array(body.subarray(offset, offset + chunkSize)));
      offset += chunkSize;
    },
  });
  const headers: Record<string, string> = {
    'content-type': 'multipart/form-data; boundary=----agentteams-test-boundary',
    'x-agentteams-user': 'alice',
    'x-agentteams-user-level': '2',
  };
  if (contentLength !== undefined) headers['content-length'] = contentLength;
  return new NextRequest(url, { method: 'POST', body: stream, headers });
}

describe('chat attachment streaming upload bounds (SEC-08)', () => {
  it('parses split multipart chunks without formData/arrayBuffer and streams to MinIO', async () => {
    const request = streamingRequest(multipart('流式内容'));
    const formData = vi.spyOn(request, 'formData');
    const arrayBuffer = vi.spyOn(request, 'arrayBuffer');
    const response = await POST(request);
    expect(response.status).toBe(200);
    expect(formData).not.toHaveBeenCalled();
    expect(arrayBuffer).not.toHaveBeenCalled();
    expect(Buffer.isBuffer(mock.put.mock.calls[0][2])).toBe(false);
    expect(mock.saved).toEqual(Buffer.from('流式内容'));
  });

  it('rejects oversized Content-Length before parsing multipart', async () => {
    const request = streamingRequest(multipart('x'), String(CHAT_ATTACHMENT_MAX_BYTES + 1024 * 1024 + 1));
    const formData = vi.spyOn(request, 'formData');
    expect((await POST(request)).status).toBe(413);
    expect(formData).not.toHaveBeenCalled();
    expect(mock.put).not.toHaveBeenCalled();
    expect(mock.proxy).not.toHaveBeenCalled();
  });

  it('rejects chunked uploads whose actual file bytes exceed the single-file cap', async () => {
    const request = streamingRequest(multipart(Buffer.alloc(CHAT_ATTACHMENT_MAX_BYTES + 1, 0x61)), undefined, 64 * 1024);
    expect((await POST(request)).status).toBe(413);
    expect(mock.put).not.toHaveBeenCalled();
  });

  it('enforces team and tenant byte quotas before writing', async () => {
    mock.list.mockImplementation((_bucket, prefix) => {
      const stream = new EventEmitter();
      queueMicrotask(() => {
        stream.emit('data', {
          name: prefix === 'teams/' ? 'teams/旅行团队/shared/聊天附件/existing' : `${prefix}existing`,
          size: prefix === 'teams/' ? CHAT_ATTACHMENT_TENANT_QUOTA_BYTES : 0,
        });
        stream.emit('end');
      });
      return stream;
    });
    expect((await POST(streamingRequest(multipart('x')))).status).toBe(413);
    expect(mock.put).not.toHaveBeenCalled();
  });

  it('rejects uploads that would exceed the team quota by actual streamed size', async () => {
    mock.list.mockImplementation((_bucket, prefix) => {
      const stream = new EventEmitter();
      queueMicrotask(() => {
        stream.emit('data', { name: `${prefix}existing`, size: prefix === 'teams/' ? 0 : CHAT_ATTACHMENT_TEAM_QUOTA_BYTES - 1 });
        stream.emit('end');
      });
      return stream;
    });
    expect((await POST(streamingRequest(multipart('123456')))).status).toBe(413);
    expect(mock.put).not.toHaveBeenCalled();
  });

  it('rejects unsafe multipart filenames', async () => {
    expect((await POST(streamingRequest(multipart('x', '../escape.md')))).status).toBe(400);
    expect(mock.put).not.toHaveBeenCalled();
  });
});
