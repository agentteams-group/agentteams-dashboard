import { describe, expect, it } from 'vitest';
import { sectionMap } from './agent-teams-dashboard';
import { createActions, isCreateActionVisible, isNavItemVisible, navItems, navGroups } from './nav-items';

describe('Navigation with groups', () => {
  it('exposes grouped top-level entries', () => {
    const ids = navItems.map((item) => item.id);
    expect(ids).toEqual([
      'overview',
      'chat',
      'tasks',
      'artifacts',
      'coding-runs',

      'workers',
      'managers',
      'teams',
      'humans',
      'skills',
      'models',
      'knowledge',
      'audit',
    ]);
    expect(navItems.every((item) => 'group' in item)).toBe(true);
  });

  it('defines all navigation groups', () => {
    const groupIds = navGroups.map((g) => g.id);
    expect(groupIds).toEqual(['core', 'runtime', 'resource']);
  });

  it('assigns correct groups to items', () => {
    const groupMap = new Map(navItems.map((item) => [item.id, item.group]));
    expect(groupMap.get('overview')).toBe('core');
    expect(groupMap.get('chat')).toBe('core');
    expect(groupMap.get('tasks')).toBe('runtime');
    expect(groupMap.get('artifacts')).toBe('runtime');
    expect(groupMap.get('coding-runs')).toBe('runtime');
    expect(groupMap.get('workers')).toBe('runtime');
    expect(groupMap.get('managers')).toBe('runtime');
    expect(groupMap.get('teams')).toBe('runtime');
    expect(groupMap.get('humans')).toBe('runtime');
    expect(groupMap.get('skills')).toBe('resource');
    expect(groupMap.get('models')).toBe('resource');
    expect(groupMap.get('knowledge')).toBe('resource');
    expect(groupMap.get('audit')).toBe('resource');
  });

  it('maps every navigation entry to a section', () => {
    expect(navItems.map((item) => item.id).every((id) => sectionMap[id])).toBe(true);
  });
});

describe('UI level gate (M19 dual track)', () => {
  it('hides admin-only nav items for L2 (level 2) users', () => {
    const ids = navItems
      .filter((item) => isNavItemVisible(item, undefined, true, 2))
      .map((item) => item.id);
    expect(ids).not.toContain('managers');
    expect(ids).not.toContain('humans');
    // Team-scoped surfaces stay visible for L2.
    expect(ids).toContain('workers');
    expect(ids).toContain('teams');
    expect(ids).toContain('audit');
  });

  it('keeps every nav item for L1 (level 3) users', () => {
    const ids = navItems
      .filter((item) => isNavItemVisible(item, undefined, true, 3))
      .map((item) => item.id);
    expect(ids).toContain('managers');
    expect(ids).toContain('humans');
  });

  it('hides the create-human action for L2 users', () => {
    const l2 = createActions.filter((a) => isCreateActionVisible(a, undefined, true, 2)).map((a) => a.id);
    expect(l2).not.toContain('create-human');
    expect(l2).toContain('create-worker');
    const l1 = createActions.filter((a) => isCreateActionVisible(a, undefined, true, 3)).map((a) => a.id);
    expect(l1).toContain('create-human');
  });

  it('defaults to full visibility when the level is unknown (fail-open UI, server enforces)', () => {
    expect(isNavItemVisible(navItems.find((i) => i.id === 'managers')!, undefined, true, undefined)).toBe(true);
  });
});
