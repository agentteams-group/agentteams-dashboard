import { describe, expect, it } from 'vitest';
import { navItems } from './nav-items';

describe('MVP navigation', () => {
  it('exposes only the seven supported top-level entries', () => {
    expect(navItems.map((item) => item.id)).toEqual([
      'overview', 'workers', 'teams', 'managers', 'humans', 'chat', 'docs',
    ]);
    expect(navItems.some((item) => 'group' in item)).toBe(false);
  });
});
