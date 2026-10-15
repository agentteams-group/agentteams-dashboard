import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest, NextResponse } from 'next/server';

const proxyToAgentTeams = vi.fn();
const getControllerUrl = vi.fn((..._a: unknown[]) => 'http://agentteams-controller:8090');
const enforceServerSideRbac = vi.fn();

vi.mock('../../../../proxy-helper', () => ({
  proxyToAgentTeams: (...a: unknown[]) => proxyToAgentTeams(...a),
  getControllerUrl: (...a: unknown[]) => getControllerUrl(...a),
}));
vi.mock('@/lib/server-auth', () => ({
  enforceServerSideRbac: (...a: unknown[]) => enforceServerSideRbac(...a),
}));

import { GET, PUT, POST } from './route';

function req(
  method: 'GET' | 'PUT' | 'POST',
  name: string,
  rest: string[],
  body?: string,
) {
  const url = `http://localhost/api/agentteams/workers/${encodeURIComponent(name)}/coding-cli/${rest.join('/')}`;
  const init: { method: string; body?: string; headers?: Record<string, string> } = { method };
  if (body !== undefined) {
    init.body = body;
    init.headers = { 'content-type': 'application/json' };
  }
  return new NextRequest(url, init);
}

function call(
  handler: (
    _r: NextRequest,
    _p: { params: Promise<{ name: string; rest: string[] }> },
  ) => Promise<NextResponse>,
  method: 'GET' | 'PUT' | 'POST',
  name: string,
  rest: string[],
  body?: string,
) {
  return handler(req(method, name, rest, body), { params: Promise.resolve({ name, rest }) });
}

const C = 'http://agentteams-controller:8090';

describe('B7 /workers/[name]/coding-cli/[...rest] 白名单', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    enforceServerSideRbac.mockResolvedValue(null);
  });

  it.each([
    ['qwen-code', '/api/v1/workers/w1/coding-cli/qwen-code/settings'],
    ['opencode', '/api/v1/workers/w1/coding-cli/opencode/settings'],
    ['qoder', '/api/v1/workers/w1/coding-cli/qoder/settings'],
  ])('GET %s/settings 转发', async (cli, path) => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({}));
    await call(GET, 'GET', 'w1', [cli, 'settings']);
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      C,
      path,
      { forwardBody: false, method: 'GET' },
    );
  });

  it('PUT settings：RBAC + forwardBody', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({}));
    await call(PUT, 'PUT', 'w1', ['qwen-code', 'settings'], '{"model":{"name":"x"}}');
    expect(enforceServerSideRbac).toHaveBeenCalledWith(
      expect.any(NextRequest),
      'update',
      'worker',
      'w1',
    );
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      C,
      '/api/v1/workers/w1/coding-cli/qwen-code/settings',
      { forwardBody: true, method: 'PUT' },
    );
  });

  it('PUT 被 RBAC 拒绝 → 不透传', async () => {
    const denied = NextResponse.json({ error: 'forbidden' }, { status: 403 });
    enforceServerSideRbac.mockResolvedValue(denied);
    const res = await call(PUT, 'PUT', 'w1', ['opencode', 'settings'], '{}');
    expect(res.status).toBe(403);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });

  it('POST install：RBAC + forwardBody', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({ task_id: 't1' }, { status: 202 }));
    await call(POST, 'POST', 'w1', ['qwen-code', 'install'], '{"action":"install"}');
    expect(enforceServerSideRbac).toHaveBeenCalled();
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      C,
      '/api/v1/workers/w1/coding-cli/qwen-code/install',
      { forwardBody: true, method: 'POST' },
    );
  });

  it('qoder 与既有 CLI 同级：PUT settings 与 POST install 均透传', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({}));
    await call(PUT, 'PUT', 'w1', ['qoder', 'settings'], '{"model":{"name":"qoder-model"}}');
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      C,
      '/api/v1/workers/w1/coding-cli/qoder/settings',
      { forwardBody: true, method: 'PUT' },
    );
    await call(POST, 'POST', 'w1', ['qoder', 'install'], '{"action":"install"}');
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      C,
      '/api/v1/workers/w1/coding-cli/qoder/install',
      { forwardBody: true, method: 'POST' },
    );
  });

  it('GET install/task_id 转发', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({ status: 'running' }));
    await call(GET, 'GET', 'w1', ['opencode', 'install', 'task-1']);
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      C,
      '/api/v1/workers/w1/coding-cli/opencode/install/task-1',
      { forwardBody: false, method: 'GET' },
    );
    expect(enforceServerSideRbac).not.toHaveBeenCalled();
  });

  it('GET install/task_id 允许 base64 字符并编码出站', async () => {
    proxyToAgentTeams.mockResolvedValue(NextResponse.json({ status: 'running' }));
    await call(GET, 'GET', 'w1', ['qwen-code', 'install', 'abc+def=']);
    expect(proxyToAgentTeams).toHaveBeenCalledWith(
      expect.any(NextRequest),
      C,
      '/api/v1/workers/w1/coding-cli/qwen-code/install/abc%2Bdef%3D',
      { forwardBody: false, method: 'GET' },
    );
  });

  it('非法 task_id 含斜杠 → 400 零透传', async () => {
    const res = await call(GET, 'GET', 'w1', ['qwen-code', 'install', 'a/b']);
    expect(res.status).toBe(400);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });

  it.each(['.', '..'])('非法 task_id %s → 400 零透传', async (taskId) => {
    const res = await call(GET, 'GET', 'w1', ['qwen-code', 'install', taskId]);
    expect(res.status).toBe(400);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });

  it.each([
    ['未知 CLI id 不在白名单', ['cursor', 'settings']],
    ['未知子路径', ['qwen-code', 'bogus']],
    ['超长段', ['qwen-code', 'install', 't1', 'x']],
    ['空 rest', []],
  ])('白名单拒绝：%s → 400 零透传', async (_label, rest) => {
    const res = await call(GET, 'GET', 'w1', rest);
    expect(res.status).toBe(400);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });

  it('POST 被 RBAC 拒绝 → 不透传', async () => {
    const denied = NextResponse.json({ error: 'forbidden' }, { status: 403 });
    enforceServerSideRbac.mockResolvedValue(denied);
    const res = await call(POST, 'POST', 'w1', ['qwen-code', 'install'], '{"action":"install"}');
    expect(res.status).toBe(403);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });

  it('非法 Worker 名 → 400 零透传', async () => {
    const res = await call(GET, 'GET', 'bad/name', ['qwen-code', 'settings']);
    expect(res.status).toBe(400);
    expect(proxyToAgentTeams).not.toHaveBeenCalled();
  });
});
