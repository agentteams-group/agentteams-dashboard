import { describe, expect, it } from 'vitest';
import {
  kindToEntityType,
  normalizeControllerEvent,
  normalizeControllerEvents,
  type ControllerAuditEvent,
} from './audit-normalize';

const BASE_TS = '2026-09-16T08:00:00.123Z';

function ev(overrides: Partial<ControllerAuditEvent> = {}): ControllerAuditEvent {
  return {
    ts: BASE_TS,
    kind: 'capability',
    actor: 'admin',
    target: 'h1',
    action: 'capability_grant',
    ...overrides,
  };
}

describe('kindToEntityType', () => {
  it('classifies deployed resource and file events instead of hiding them under system', () => {
    expect(kindToEntityType('human_created')).toBe('human');
    expect(kindToEntityType('human_file_write')).toBe('human');
    expect(kindToEntityType('worker_updated')).toBe('worker');
    expect(kindToEntityType('team_created')).toBe('team');
    expect(kindToEntityType('manager_updated')).toBe('manager');
  });
  it('maps capability/approval_level to human, channel to worker, source to system', () => {
    expect(kindToEntityType('capability')).toBe('human');
    expect(kindToEntityType('approval_level')).toBe('human');
    expect(kindToEntityType('channel')).toBe('worker');
    expect(kindToEntityType('source')).toBe('system');
  });

  it('unknown future kinds fall back to system (visible, not entity-filterable)', () => {
    expect(kindToEntityType('some_future_action')).toBe('system');
  });
});

describe('normalizeControllerEvent', () => {
  it('maps the canonical capability grant shape', () => {
    const n = normalizeControllerEvent(
      ev({
        targetTeam: 'alpha-team',
        capability: 'approval_policy',
        before: ['approval_policy'],
        after: ['approval_policy', 'channel_secrets'],
      }),
      0,
    );
    expect(n.entity_type).toBe('human');
    expect(n.entity_name).toBe('h1');
    expect(n.team).toBe('alpha-team');
    expect(n.kind).toBe('capability');
    expect(n.severity).toBe('info');
    expect(n.timestamp).toBe(Date.parse(BASE_TS));
    expect(n.details).toContain('approval_policy');
    expect(n.details).toContain('→');
    expect(n.details).toContain('team: alpha-team');
    expect(n.id).toMatch(/^ctrl-0-/);
  });

  it('prefers the controlled detail string over a derived diff', () => {
    const n = normalizeControllerEvent(
      ev({ detail: 'channel credential rotated', capability: 'x', before: ['a'], after: ['b'] }),
      3,
    );
    expect(n.details).toBe('channel credential rotated');
    expect(n.id).toContain('ctrl-3-');
  });

  it('falls back to targetTeam when target is absent', () => {
    const n = normalizeControllerEvent(
      ev({ target: undefined, targetTeam: 'beta-team', kind: 'channel', action: 'channel_update' }),
      1,
    );
    expect(n.entity_type).toBe('worker');
    expect(n.entity_name).toBe('beta-team');
  });

  it('survives an unparseable timestamp without throwing', () => {
    const n = normalizeControllerEvent(ev({ ts: 'not-a-date' }), 0);
    expect(typeof n.timestamp).toBe('number');
    expect(n.timestamp).not.toBeNaN();
  });
});

describe('normalizeControllerEvents', () => {
  it('returns null for a non-object or missing events array', () => {
    expect(normalizeControllerEvents(null)).toBeNull();
    expect(normalizeControllerEvents('x')).toBeNull();
    expect(normalizeControllerEvents({})).toBeNull();
    expect(normalizeControllerEvents({ events: 'nope' })).toBeNull();
  });

  it('skips malformed entries and indexes survivors by position', () => {
    const out = normalizeControllerEvents({
      events: [ev(), { bogus: true }, ev({ action: 'capability_revoke' })],
    });
    expect(out).not.toBeNull();
    expect(out!.length).toBe(2);
    expect(out![0].action).toBe('capability_grant');
    expect(out![1].action).toBe('capability_revoke');
  });

  it('returns an empty array for an empty page (not null)', () => {
    expect(normalizeControllerEvents({ events: [] })).toEqual([]);
  });
});
