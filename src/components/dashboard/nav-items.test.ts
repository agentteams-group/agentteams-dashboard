import { describe, expect, it } from 'vitest';
import { sectionMap } from './agent-teams-dashboard';
import {
  createActions,
  isCreateActionVisible,
  isNavItemVisible,
  navItems,
  navGroups,
  navAreas,
  legacyNavGroups,
} from './nav-items';

describe('Navigation with groups (Workbench IA)', () => {
  it('exposes the Workbench sections with zero removals (PRD §5.2 + M3 循环)', () => {
    const ids = navItems.map((item) => item.id);
    expect(ids).toEqual([
      // 工作台
      'my-workbench',
      'chat',
      'tasks',
      'artifacts',
      'coding-runs',
      'loops',
      // 控制台
      'workers',
      'managers',
      'teams',
      'humans',
      'skills',
      'models',
      'knowledge',
      'audit',
      'overview',
    ]);
    expect(ids).toContain('tasks'); // 13 项零删减基线
    expect(navItems.every((item) => 'group' in item)).toBe(true);
    expect(navItems.every((item) => 'area' in item)).toBe(true);
  });

  it('defines the two IA areas and their groups', () => {
    expect(navAreas.map((a) => a.id)).toEqual(['workbench', 'console']);
    expect(navGroups.map((g) => g.id)).toEqual([
      'mine',
      'space',
      'task-center',
      'loop',
      'resources',
      'governance',
      'system',
    ]);
  });

  it('assigns items to workbench groups', () => {
    const byId = new Map(navItems.map((item) => [item.id, item]));
    expect(byId.get('my-workbench')).toMatchObject({ area: 'workbench', group: 'mine' });
    expect(byId.get('chat')).toMatchObject({ area: 'workbench', group: 'space' });
    expect(byId.get('tasks')).toMatchObject({ area: 'workbench', group: 'task-center' });
    expect(byId.get('artifacts')).toMatchObject({ area: 'workbench', group: 'task-center' });
    expect(byId.get('coding-runs')).toMatchObject({ area: 'workbench', group: 'task-center' });
    expect(byId.get('loops')).toMatchObject({ area: 'workbench', group: 'loop' });
  });

  it('assigns items to console groups (附录 A 归属)', () => {
    const byId = new Map(navItems.map((item) => [item.id, item]));
    expect(byId.get('workers')).toMatchObject({ area: 'console', group: 'resources' });
    expect(byId.get('managers')).toMatchObject({ area: 'console', group: 'resources' });
    expect(byId.get('teams')).toMatchObject({ area: 'console', group: 'resources' });
    expect(byId.get('humans')).toMatchObject({ area: 'console', group: 'resources' });
    expect(byId.get('skills')).toMatchObject({ area: 'console', group: 'resources' });
    expect(byId.get('models')).toMatchObject({ area: 'console', group: 'resources' });
    expect(byId.get('knowledge')).toMatchObject({ area: 'console', group: 'resources' });
    expect(byId.get('audit')).toMatchObject({ area: 'console', group: 'governance' });
    expect(byId.get('overview')).toMatchObject({ area: 'console', group: 'system' });
  });

  it('keeps a legacy grouping for the classic-navigation switch', () => {
    expect(legacyNavGroups.map((g) => g.id)).toEqual(['core', 'runtime', 'resource']);
    // Every pre-Workbench item must keep a legacy home so classic mode shows
    // all 13 v1.x sections. M3 新增的 loops 在 v1.x 无对应导航，经典模式不显示。
    const withoutM3 = navItems.filter((item) => item.id !== 'loops' && item.id !== 'my-workbench');
    expect(withoutM3.every((item) => item.legacyGroup)).toBe(true);
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
