// @vitest-environment node
// 最小 RBAC/脱敏用例（SEC）：wen-tian 日志诊断属 admin-grade 操作（manage 门），
// 且日志脱敏恒开启——redact:false 直接 400，日志凭据不得进入 LLM prompt。
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { SERVER_USER_HEADER, SERVER_USER_LEVEL_HEADER } from '@/lib/server-auth';

const auditMock = vi.hoisted(() => ({
  appendAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/audit-log', () => auditMock);

vi.mock('../../proxy-helper', () => ({
  getAuthToken: vi.fn().mockResolvedValue('sa-token'),
  getControllerUrl: vi.fn().mockReturnValue('http://agentteams-controller:8090'),
}));

vi.mock('../../debug-log/docker', () => ({
  listAgentTeamsContainers: vi.fn().mockResolvedValue([]),
  inspectContainer: vi.fn(),
  getContainerLogs: vi.fn(),
}));

vi.mock('../../debug-log/sessions', () => ({
  exportAgentSessions: vi.fn().mockResolvedValue({
    containers: 0,
    sessions: 0,
    events: 0,
    files: {},
    errors: [],
  }),
}));

vi.mock('../../debug-log/matrix', () => ({
  exportMatrixMessages: vi.fn(),
}));

function buildRequest(rawBody: string, level?: number): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (level !== undefined) {
    headers[SERVER_USER_HEADER] = level === 3 ? 'admin' : 'observer';
    headers[SERVER_USER_LEVEL_HEADER] = String(level);
  }
  return new NextRequest('http://localhost/api/agentteams/wen-tian/logs', {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

const SECRET_LOG =
  'ERROR auth failed: sk-abcdefghijklmnopqrstuvwx, Authorization: Bearer mysecrettoken1234567, AK=LTAI5tAbcdefGhijklmno';

describe('POST /api/agentteams/wen-tian/logs (manage 门 + 强制脱敏)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    delete process.env.AGENTTEAMS_LLM_API_KEY;
    delete process.env.AGENTTEAMS_DEFAULT_MODEL;
  });

  it('L1 观察者会话被 manage 门拒绝（403），不触发任何采集', async () => {
    const res = await POST(buildRequest('{"range": "1h"}', 1));
    expect(res.status).toBe(403);
    const { listAgentTeamsContainers, getContainerLogs } = await import('../../debug-log/docker');
    expect(listAgentTeamsContainers).not.toHaveBeenCalled();
    expect(getContainerLogs).not.toHaveBeenCalled();
    expect(auditMock.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rbac.deny.manage',
        entity_name: 'logs',
        actor_level: 1,
        severity: 'warning',
      }),
    );
  });

  it('L3 会话传 redact:false 被拒绝（400，日志始终脱敏）', async () => {
    const res = await POST(buildRequest('{"redact": false}', 3));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/always redacted/i);
  });

  it('L3 会话采集中容器日志里的凭据不进入 LLM prompt（脱敏恒开启）', async () => {
    const { listAgentTeamsContainers, inspectContainer, getContainerLogs } = await import(
      '../../debug-log/docker'
    );
    vi.mocked(listAgentTeamsContainers).mockResolvedValueOnce(['agent-a']);
    vi.mocked(inspectContainer).mockResolvedValueOnce({
      image: 'agentteams/worker:latest',
      restart_count: 0,
      state: { Status: 'running', Running: true },
    } as never);
    vi.mocked(getContainerLogs).mockResolvedValueOnce(SECRET_LOG);

    // 捕获 LLM 请求体以校验 prompt 内的凭据已脱敏；SSE 响应含一条 chunk + [DONE]。
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        'data: {"choices":[{"delta":{"content":"诊断完成"}}]}\n\ndata: [DONE]\n\n',
        { status: 200, headers: { 'content-type': 'text/event-stream' } }
      )
    );
    vi.stubGlobal('fetch', fetchMock);
    process.env.AGENTTEAMS_LLM_API_KEY = 'test-key';
    process.env.AGENTTEAMS_DEFAULT_MODEL = 'test-model';

    const res = await POST(buildRequest('{"symptom":"worker 反复重启"}', 3));
    expect(res.status).toBe(200);
    const sse = await res.text();
    expect(sse).toContain('event: summary');
    expect(sse).toContain('event: result');

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const init = fetchMock.mock.calls[0][1] as { body: string };
    const prompt = (JSON.parse(init.body).messages as Array<{ content: string }>)[0].content;
    expect(prompt).not.toContain('sk-abcdefghijklmnopqrstuvwx');
    expect(prompt).not.toContain('mysecrettoken1234567');
    expect(prompt).not.toContain('LTAI5tAbcdefGhijklmno');
    expect(prompt).toContain('****');
  });
});
