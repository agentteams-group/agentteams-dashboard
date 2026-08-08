import { describe, expect, it } from 'vitest';
import { navItems, navGroups } from './nav-items';

describe('Navigation with groups', () => {
  it('exposes grouped top-level entries', () => {
    const ids = navItems.map((item) => item.id);
    expect(ids).toEqual([
      'overview',
      'chat',
      'docs',
      'workers',
      'managers',
      'teams',
      'humans',
      'skills',
      'mcps',
      'models',
      'logs',
      'debug-export',
      'trace-status',
      'troubleshoot',
    ]);
    expect(navItems.every((item) => 'group' in item)).toBe(true);
  });

  it('defines all navigation groups', () => {
    const groupIds = navGroups.map((g) => g.id);
    expect(groupIds).toEqual(['core', 'runtime', 'resource', 'ops']);
  });

  it('assigns correct groups to items', () => {
    const groupMap = new Map(navItems.map((item) => [item.id, item.group]));
    expect(groupMap.get('overview')).toBe('core');
    expect(groupMap.get('chat')).toBe('core');
    expect(groupMap.get('workers')).toBe('runtime');
    expect(groupMap.get('managers')).toBe('runtime');
    expect(groupMap.get('teams')).toBe('runtime');
    expect(groupMap.get('humans')).toBe('runtime');
    expect(groupMap.get('skills')).toBe('resource');
    expect(groupMap.get('mcps')).toBe('resource');
    expect(groupMap.get('models')).toBe('resource');
    expect(groupMap.get('logs')).toBe('ops');
    expect(groupMap.get('debug-export')).toBe('ops');
    expect(groupMap.get('trace-status')).toBe('ops');
    expect(groupMap.get('troubleshoot')).toBe('ops');
  });
});
