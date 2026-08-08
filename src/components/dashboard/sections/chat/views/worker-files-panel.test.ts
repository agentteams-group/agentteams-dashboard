import { describe, expect, it } from 'vitest';
import { computeNextPrefix } from './worker-files-panel';

describe('computeNextPrefix', () => {
  it('navigates from root into a directory', () => {
    expect(computeNextPrefix('', 'manager/skills/')).toBe('manager/skills/');
  });

  it('navigates into a directory again after going back (regression: first letter must not drop)', () => {
    expect(computeNextPrefix('manager/', 'manager/skills/')).toBe('manager/skills/');
  });

  it('navigates into a subdirectory (regression: first letter must not drop)', () => {
    expect(computeNextPrefix('manager/skills/', 'manager/skills/agentteams-find-worker/')).toBe(
      'manager/skills/agentteams-find-worker/',
    );
  });

  it('navigates into a directory named like the worker (regression)', () => {
    expect(computeNextPrefix('manager/', 'manager/manager/')).toBe('manager/manager/');
  });

  it('keeps prefix unchanged when the relative path is empty or malformed', () => {
    expect(computeNextPrefix('manager/', 'manager/')).toBe('manager/');
    expect(computeNextPrefix('manager/', 'manager//')).toBe('manager/');
  });
});
