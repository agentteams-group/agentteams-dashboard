import { describe, expect, it } from 'vitest';
import { isTeamAdmin } from './team-access';

describe('Team Admin identity', () => {
  it('requires the configured owner, including for platform administrators', () => {
    const team = { admin: { name: 'alice' } };
    expect(isTeamAdmin(team, 'alice')).toBe(true);
    expect(isTeamAdmin(team, 'admin')).toBe(false);
    expect(isTeamAdmin({ admin: null }, 'admin')).toBe(false);
    expect(isTeamAdmin(team, null)).toBe(false);
  });

  it('uses a projected Matrix identity when available and rejects a conflicting session', () => {
    const team = { admin: { name: 'human-alice', matrixUserId: '@alice:example.test' } };
    expect(isTeamAdmin(team, 'alice', '@alice:example.test')).toBe(true);
    expect(isTeamAdmin(team, 'human-alice', '@other:example.test')).toBe(false);
  });
});
