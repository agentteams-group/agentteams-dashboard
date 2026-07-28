import { describe, expect, it } from 'vitest';
import {
  navItems,
  navGroups,
  NavItem,
  getGroupItems,
  isGroupVisible,
  getNewHashFromOld,
} from './nav-items';

describe('navItems group consistency', () => {
  it('every item with a group references an existing navGroup', () => {
    const groupIds = new Set(navGroups.map((g) => g.id));
    for (const item of navItems) {
      if (item.group) {
        expect(groupIds.has(item.group)).toBe(true);
      }
    }
  });

  it('every group has at least one navItem', () => {
    for (const group of navGroups) {
      const items = navItems.filter((i) => i.group === group.id);
      expect(items.length).toBeGreaterThan(0);
    }
  });

  it('docs item has no group (persistent entry)', () => {
    const docs = navItems.find((i) => i.id === 'docs');
    expect(docs).toBeDefined();
    expect(docs!.group).toBeUndefined();
  });

  it('navGroups entries match the five expected ids', () => {
    const ids = navGroups.map((g) => g.id);
    expect(ids).toEqual(['overview', 'agents', 'ai-gateway', 'platform', 'governance']);
  });
});

describe('getGroupItems', () => {
  it('returns workers/teams/managers/humans/chat for agents group', () => {
    const items = getGroupItems('agents', navItems, 'embedded');
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(['workers', 'teams', 'managers', 'humans', 'chat']);
  });

  it('returns only topology and ops for platform group', () => {
    const items = getGroupItems('platform', navItems, 'embedded');
    const ids = items.map((i) => i.id);
    expect(ids).toEqual(['topology', 'ops']);
  });

  it('filters items by mode', () => {
    const testItems: NavItem[] = [
      { id: 'a', label: 'A', icon: {} as any, group: 'g', modes: ['k8s'] },
      { id: 'b', label: 'B', icon: {} as any, group: 'g' },
    ];
    const k8sItems = getGroupItems('g', testItems, 'k8s');
    expect(k8sItems.map((i) => i.id)).toEqual(['a', 'b']);

    const embeddedItems = getGroupItems('g', testItems, 'embedded');
    expect(embeddedItems.map((i) => i.id)).toEqual(['b']);
  });

  it('returns empty array for unknown group', () => {
    expect(getGroupItems('nonexistent', navItems, 'embedded')).toEqual([]);
  });
});

describe('isGroupVisible', () => {
  it('returns true for a group with visible items', () => {
    expect(isGroupVisible('agents', navItems, 'embedded')).toBe(true);
  });

  it('returns false for an empty group', () => {
    expect(isGroupVisible('nonexistent', navItems, 'embedded')).toBe(false);
  });

  it('returns false when all items are hidden by mode', () => {
    const testItems: NavItem[] = [
      { id: 'x', label: 'X', icon: {} as any, group: 'h', modes: ['k8s'] },
    ];
    expect(isGroupVisible('h', testItems, 'embedded')).toBe(false);
    expect(isGroupVisible('h', testItems, 'k8s')).toBe(true);
  });
});

describe('getNewHashFromOld', () => {
  it('maps workers -> agents/workers', () => {
    expect(getNewHashFromOld('workers')).toBe('agents/workers');
  });

  it('maps overview -> overview/overview', () => {
    expect(getNewHashFromOld('overview')).toBe('overview/overview');
  });

  it('maps gateway -> ai-gateway/gateway', () => {
    expect(getNewHashFromOld('gateway')).toBe('ai-gateway/gateway');
  });

  it('maps docs -> null (no group)', () => {
    expect(getNewHashFromOld('docs')).toBeNull();
  });

  it('returns null for empty hash', () => {
    expect(getNewHashFromOld('')).toBeNull();
  });

  it('returns null when already in new format', () => {
    expect(getNewHashFromOld('agents/workers')).toBeNull();
  });

  it('returns null for unknown section id', () => {
    expect(getNewHashFromOld('unknown-section')).toBeNull();
  });
});
