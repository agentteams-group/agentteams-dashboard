import { describe, beforeEach, afterEach, it, expect, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { POST } from './route';
import { resetAuditLogForTests, setAuditLogPathForTests, listAuditEvents } from '@/lib/audit-log';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getSessionFromRequest } from '@/lib/dashboard-session';

vi.mock('@/lib/dashboard-session', () => ({
  getSessionFromRequest: vi.fn(),
}));

const mockedSession = vi.mocked(getSessionFromRequest);

function postRequest(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/agentteams/hitl/audit', {
    method: 'POST',
    body: JSON.stringify(body),
    headers: { 'Content-Type': 'application/json' },
  });
}

describe('POST /api/agentteams/hitl/audit（F2.4）', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setAuditLogPathForTests(join(mkdtempSync(join(tmpdir(), 'hitl-audit-')), 'audit.log.jsonl'));
  });

  afterEach(() => {
    resetAuditLogForTests();
  });

  it('hitl.answer：session 归因 + 答案/耗时落 details', async () => {
    mockedSession.mockReturnValue({
      sid: 's1',
      user: 'alice',
      level: 2,
      crLevel: 2,
      teams: [],
      credential: { kind: 'matrix', token: 't' },
    } as unknown as ReturnType<typeof getSessionFromRequest>);
    const res = await POST(
      postRequest({
        action: 'answer',
        confirmation_id: 'c1',
        answer: '【干预答复】A1：按模块',
        elapsed_ms: 42000,
      }),
    );
    expect(res.status).toBe(200);
    const events = await listAuditEvents({ limit: 10 });
    const hit = events.find((e) => e.action === 'hitl.answer');
    expect(hit?.actor).toBe('alice');
    expect(hit?.actor_level).toBe(2);
    expect(hit?.details).toContain('c1');
    expect(hit?.details).toContain('按模块');
    expect(hit?.details).toContain('42000');
  });

  it('hitl.expire：severity=warning；hitl.request 正常记录', async () => {
    mockedSession.mockReturnValue(null);
    await POST(postRequest({ action: 'expire', confirmation_id: 'c2', actor: '@agent:example.org' }));
    await POST(postRequest({ action: 'request', confirmation_id: 'c3', room_id: '!r:x', question: '泳道？' }));
    const events = await listAuditEvents({ limit: 10 });
    expect(events.find((e) => e.action === 'hitl.expire')?.severity).toBe('warning');
    expect(events.find((e) => e.action === 'hitl.expire')?.actor).toBe('@agent:example.org');
    const request = events.find((e) => e.action === 'hitl.request');
    expect(request?.details).toContain('泳道？');
  });

  it('白名单外 action / 缺 confirmation_id → 400', async () => {
    const res1 = await POST(postRequest({ action: 'hack', confirmation_id: 'c' }));
    const res2 = await POST(postRequest({ action: 'answer' }));
    expect(res1.status).toBe(400);
    expect(res2.status).toBe(400);
    expect((await listAuditEvents({ limit: 10 })).length).toBe(0);
  });
});
