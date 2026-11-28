// @vitest-environment node
import { Readable } from 'node:stream';
import { EventEmitter } from 'node:events';
import { NextRequest, NextResponse } from 'next/server';
import { beforeEach, expect, it, vi } from 'vitest';
import { GET, POST } from './route';

const mock = vi.hoisted(() => ({ proxy: vi.fn(), list: vi.fn(), put: vi.fn(), stat: vi.fn(), get: vi.fn() }));
vi.mock('../proxy-helper', () => ({ getControllerUrl: () => '', proxyToAgentTeams: mock.proxy }));
vi.mock('@/lib/minio-client', () => ({
  getMinioBucket: () => 'bucket',
  createMinioClient: () => ({ listObjects: mock.list, putObject: mock.put, statObject: mock.stat, getObject: mock.get }),
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
      for (const name of ['index.HTML', 'app.min.js', 'layout.css', 'search.test.tsx', 'Dockerfile']) {
        stream.emit('data', { name: prefix + name, size: 12 });
      }
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
  const keys = (await listing.json()).objects.map((obj: { key: string }) => obj.key);
  expect(keys).toContain('聊天附件/报告.md');
  expect(keys).toContain('聊天附件/index.HTML');
  expect(mock.list).toHaveBeenCalledWith('bucket', 'teams/旅行团队/shared/聊天附件/', false);
  expect((await POST(request({ team: 'travel' }, 'outsider'))).status).toBe(403);
  expect((await POST(request({ team: 'travel' }, 'alice', 'tasks/t1/'))).status).toBe(403);
  expect(mock.put).not.toHaveBeenCalled();
  const saved = await POST(request({ team: 'travel' }, 'alice'));
  expect(saved.status).toBe(200);
  const { key } = await saved.json();
  expect(key).toMatch(/^聊天附件\/[a-f0-9-]+-报告\.md$/);
  expect(mock.put).toHaveBeenCalledWith('bucket', 'teams/旅行团队/shared/' + key, Buffer.from('报告'), 6, { 'content-type': 'text/markdown' });
});


it('keeps a declared standalone HTML directly viewable while excluding sources from the file list', async () => {
  const html = '<html><body>hello</body></html>';
  mock.stat.mockResolvedValue({ size: html.length, metaData: { 'content-type': 'text/html' } });
  mock.get.mockResolvedValue(Readable.from([Buffer.from(html)]));
  const response = await GET(request({ room: '!task:test', key: 'hello.html' }));
  expect(response.status).toBe(200);
  expect(await response.text()).toBe(html);
  expect(response.headers.get('Content-Type')).toBe('text/html');
  expect(response.headers.get('Content-Disposition')).toContain('attachment;');
  expect(mock.get).toHaveBeenCalledWith('bucket', 'teams/旅行团队/shared/tasks/t1/hello.html');
});
