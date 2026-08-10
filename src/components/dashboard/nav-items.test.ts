import { describe, expect, it } from 'vitest';
import { sectionMap } from './agent-teams-dashboard';
import { navItems, navGroups } from './nav-items';

describe('Navigation with groups', () => {
  it('exposes grouped top-level entries', () => {
    const ids = navItems.map((item) => item.id);
    expect(ids).toEqual([
      'overview',
      'chat',
      'tasks',
      'workers',
      'managers',
      'teams',
      'humans',
      'skills',
      'models',
      'docs',
    ]);
    expect(navItems.every((item) => 'group' in item)).toBe(true);
  });

  it('defines all navigation groups', () => {
    const groupIds = navGroups.map((g) => g.id);
    expect(groupIds).toEqual(['core', 'runtime', 'resource', 'footer']);
  });

  it('assigns correct groups to items', () => {
    const groupMap = new Map(navItems.map((item) => [item.id, item.group]));
    expect(groupMap.get('overview')).toBe('core');
    expect(groupMap.get('chat')).toBe('core');
    expect(groupMap.get('tasks')).toBe('runtime');
    expect(groupMap.get('workers')).toBe('runtime');
    expect(groupMap.get('managers')).toBe('runtime');
    expect(groupMap.get('teams')).toBe('runtime');
    expect(groupMap.get('humans')).toBe('runtime');
    expect(groupMap.get('skills')).toBe('resource');
    expect(groupMap.get('models')).toBe('resource');
    expect(groupMap.get('docs')).toBe('footer');
  });

  it('maps every navigation entry to a section', () => {
    expect(navItems.map((item) => item.id).every((id) => sectionMap[id])).toBe(true);
  });
});
