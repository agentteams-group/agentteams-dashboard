// @vitest-environment node
import { describe, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { unzipSync } from 'fflate';
import { POST } from './route';
import { SERVER_USER_HEADER, SERVER_USER_LEVEL_HEADER } from '@/lib/server-auth';

// L1 拒绝时会写审计日志——mock 掉以保证测试不落盘。
const auditMock = vi.hoisted(() => ({
  appendAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('@/lib/audit-log', () => auditMock);

vi.mock('../proxy-helper', () => ({
  getAuthToken: vi.fn().mockResolvedValue('sa-token'),
  getControllerUrl: vi.fn().mockReturnValue('http://agentteams-controller:8090'),
}));

vi.mock('./docker', () => ({
  listAgentTeamsContainers: vi.fn().mockResolvedValue([]),
  inspectContainer: vi.fn(),
  getContainerLogs: vi.fn(),
}));

vi.mock('./sessions', () => ({
  exportAgentSessions: vi.fn().mockResolvedValue({
    containers: 0,
    sessions: 0,
    events: 0,
    files: {},
    errors: [],
  }),
}));

vi.mock('./matrix', () => ({
  exportMatrixMessages: vi.fn(),
}));

function buildRequest(rawBody: string, level?: number): NextRequest {
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (level !== undefined) {
    headers[SERVER_USER_HEADER] = level === 3 ? 'admin' : 'observer';
    headers[SERVER_USER_LEVEL_HEADER] = String(level);
  }
  return new NextRequest('http://localhost/api/agentteams/debug-log', {
    method: 'POST',
    headers,
    body: rawBody,
  });
}

describe('POST /api/agentteams/debug-log', () => {
  it('returns 400 for a null JSON body', async () => {
    const res = await POST(buildRequest('null'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json).toHaveProperty('error');
  });

  it('returns 400 for a JSON array body', async () => {
    const res = await POST(buildRequest('[]'));
    expect(res.status).toBe(400);
  });

  it('returns 400 when range is not a string', async () => {
    const res = await POST(buildRequest('{"range": 5}'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/must be a string/);
  });

  it('returns 400 when redact is not a boolean', async () => {
    const res = await POST(buildRequest('{"redact": "yes"}'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/must be a boolean/);
  });

  it('returns 400 for an oversized range', async () => {
    const res = await POST(buildRequest('{"range": "10000d"}'));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/too large/i);
  });

  it('returns a zip bundle with summary.txt for an empty collection (L3 session)', async () => {
    const res = await POST(buildRequest('{}', 3));
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/zip');
    const buf = await res.arrayBuffer();
    const files = unzipSync(new Uint8Array(buf));
    expect(files['summary.txt']).toBeDefined();
    const summary = new TextDecoder().decode(files['summary.txt']);
    expect(summary).toContain('AgentTeams Debug Log');
    expect(summary).toContain('Matrix export skipped');
  });
});

describe('POST /api/agentteams/debug-log L3 写门与强制脱敏', () => {
  it('L1 观察者会话被 manage 门拒绝（403），不触发任何采集', async () => {
    const res = await POST(buildRequest('{"range": "1h"}', 1));
    expect(res.status).toBe(403);
    const { listAgentTeamsContainers, getContainerLogs } = await import('./docker');
    expect(listAgentTeamsContainers).not.toHaveBeenCalled();
    expect(getContainerLogs).not.toHaveBeenCalled();
    expect(auditMock.appendAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'rbac.deny.manage',
        entity_name: 'collect',
        actor_level: 1,
        severity: 'warning',
      }),
    );
  });

  it('L3 会话传 redact:false 被 parseBody 拒绝（400，调试包始终脱敏）', async () => {
    const res = await POST(buildRequest('{"redact": false}', 3));
    expect(res.status).toBe(400);
    const json = await res.json();
    expect(json.error).toMatch(/always redacted/i);
  });

  it('L3 会话采集的容器日志中 sk-/Bearer/LTAI 凭据仍被替换（脱敏恒开启）', async () => {
    const { listAgentTeamsContainers, inspectContainer, getContainerLogs } = await import('./docker');
    vi.mocked(listAgentTeamsContainers).mockResolvedValueOnce(['agent-a']);
    vi.mocked(inspectContainer).mockResolvedValueOnce({
      image: 'agentteams/worker:latest',
      restart_count: 0,
      state: { Status: 'running', Running: true },
    } as never);
    vi.mocked(getContainerLogs).mockResolvedValueOnce(
      'ERROR auth failed: sk-abcdefghijklmnopqrstuvwx, Authorization: Bearer mysecrettoken1234567, AK=LTAI5tAbcdefGhijklmno'
    );
    const res = await POST(buildRequest('{}', 3));
    expect(res.status).toBe(200);
    const buf = await res.arrayBuffer();
    const files = unzipSync(new Uint8Array(buf));
    const log = new TextDecoder().decode(files['container-logs/agent-a.log']);
    expect(log).not.toContain('sk-abcdefghijklmnopqrstuvwx');
    expect(log).not.toContain('mysecrettoken1234567');
    expect(log).not.toContain('LTAI5tAbcdefGhijklmno');
    expect(log).toContain('****');
  });
});
