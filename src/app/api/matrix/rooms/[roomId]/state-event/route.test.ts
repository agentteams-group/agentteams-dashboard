import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';

const mockAppendAuditEvent = vi.fn();

vi.mock('@/lib/audit-log', () => ({
  appendAuditEvent: (...args: unknown[]) => mockAppendAuditEvent(...args),
}));

vi.mock('@/lib/dashboard-session', () => ({
  getSessionFromRequest: async () => null,
}));

import { POST, auditActionFor } from './route';

function buildRequest(eventType: string, content: Record<string, unknown>): NextRequest {
  return new NextRequest(
    'http://dashboard.test/api/matrix/rooms/room/state-event?homeserver=http%3A%2F%2F127.0.0.1%3A6167',
    {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ eventType, stateKey: 'k', content }),
    }
  );
}

describe('auditActionFor', () => {
  it('maps each state domain to its own audit action', () => {
    expect(auditActionFor('com.agentteams.release', { action: 'release' })).toBe(
      'release.release'
    );
    expect(auditActionFor('com.agentteams.release', { action: 'revoke' })).toBe(
      'release.revoke'
    );
    expect(auditActionFor('com.agentteams.space', { auto_release: true })).toBe('space.update');
    expect(auditActionFor('com.agentteams.loop.definition', {})).toBe('loop.update');
  });

  it('falls back to state.update for other namespaced events', () => {
    expect(auditActionFor('com.agentteams.other', {})).toBe('state.update');
  });
});

describe('POST state-event audit attribution', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    mockAppendAuditEvent.mockReset();
  });

  it('records space config writes as space.update', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );

    const response = await POST(
      buildRequest('com.agentteams.space', { auto_release: true, actor: '@me:hs', ts: 1 }),
      { params: Promise.resolve({ roomId: '!room:hs' }) }
    );

    expect(response.status).toBe(200);
    expect(mockAppendAuditEvent).toHaveBeenCalledOnce();
    expect(mockAppendAuditEvent.mock.calls[0][0]).toMatchObject({
      action: 'space.update',
      actor: '@me:hs',
    });
  });

  it('records loop definition writes as loop.update', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } })
    );

    await POST(
      buildRequest('com.agentteams.loop.definition', { id: 'l1', actor: '@me:hs' }),
      { params: Promise.resolve({ roomId: '!room:hs' }) }
    );

    expect(mockAppendAuditEvent.mock.calls[0][0]).toMatchObject({ action: 'loop.update' });
  });
});
