// @vitest-environment node
import { beforeEach, describe, expect, it } from 'vitest';
import { sortContributions, useExtensionStore } from './extension-store';
import type { MenuItemContribution, WidgetContribution } from './types';

function menuItem(id: string, order?: number): MenuItemContribution {
  return { id, label: id, icon: 'star', target: { type: 'section', sectionId: 'overview' }, order };
}
function widget(id: string, order?: number): WidgetContribution {
  return { id, title: id, component: (() => null) as unknown as WidgetContribution['component'], order };
}

describe('extension store', () => {
  beforeEach(() => {
    useExtensionStore.getState().clear();
  });

  it('adds contributions to the correct list', () => {
    useExtensionStore.getState().add('menuItems', 'p1', menuItem('home'));
    useExtensionStore.getState().add('widgets', 'p1', widget('w1'));

    const state = useExtensionStore.getState();
    expect(state.menuItems).toHaveLength(1);
    expect(state.widgets).toHaveLength(1);
    expect(state.routes).toHaveLength(0);
    expect(state.detailBlocks).toHaveLength(0);
    expect(state.toolbarButtons).toHaveLength(0);
  });

  it('tags contributions with the owning plugin id', () => {
    useExtensionStore.getState().add('menuItems', 'owner-plugin', menuItem('x'));
    expect(useExtensionStore.getState().menuItems[0].pluginId).toBe('owner-plugin');
  });

  it('upserts by plugin+contribution id (no duplicates)', () => {
    useExtensionStore.getState().add('menuItems', 'p1', menuItem('home'));
    useExtensionStore.getState().add('menuItems', 'p1', menuItem('home'));
    expect(useExtensionStore.getState().menuItems).toHaveLength(1);
    // Same id from a different plugin is a separate entry.
    useExtensionStore.getState().add('menuItems', 'p2', menuItem('home'));
    expect(useExtensionStore.getState().menuItems).toHaveLength(2);
  });

  it('removeFrom removes a single contribution', () => {
    useExtensionStore.getState().add('menuItems', 'p1', menuItem('a'));
    useExtensionStore.getState().add('menuItems', 'p1', menuItem('b'));
    useExtensionStore.getState().removeFrom('menuItems', 'p1', 'a');
    const remaining = useExtensionStore.getState().menuItems;
    expect(remaining).toHaveLength(1);
    expect(remaining[0].contribution.id).toBe('b');
  });

  it('removePlugin removes every contribution of that plugin only', () => {
    useExtensionStore.getState().add('menuItems', 'p1', menuItem('m1'));
    useExtensionStore.getState().add('widgets', 'p1', widget('w1'));
    useExtensionStore.getState().add('menuItems', 'p2', menuItem('m2'));

    useExtensionStore.getState().removePlugin('p1');

    const state = useExtensionStore.getState();
    expect(state.menuItems.map((r) => r.pluginId)).toEqual(['p2']);
    expect(state.widgets).toHaveLength(0);
  });

  it('clear empties all lists', () => {
    useExtensionStore.getState().add('menuItems', 'p1', menuItem('m1'));
    useExtensionStore.getState().add('widgets', 'p1', widget('w1'));
    useExtensionStore.getState().clear();
    const state = useExtensionStore.getState();
    expect(state.menuItems).toHaveLength(0);
    expect(state.widgets).toHaveLength(0);
  });
});

describe('sortContributions', () => {
  it('orders by explicit order then registration order', () => {
    const records = [
      { pluginId: 'a', contribution: menuItem('later', 1), registeredAt: 100 },
      { pluginId: 'b', contribution: menuItem('first', 0), registeredAt: 200 },
      { pluginId: 'c', contribution: menuItem('middle', 1), registeredAt: 50 },
    ];
    const sorted = sortContributions(records).map((r) => r.contribution.id);
    // order 0 first; among order 1, earlier registeredAt first
    expect(sorted).toEqual(['first', 'middle', 'later']);
  });

  it('treats missing order as 0', () => {
    const records = [
      { pluginId: 'a', contribution: menuItem('no-order'), registeredAt: 10 },
      { pluginId: 'b', contribution: menuItem('ordered', 5), registeredAt: 1 },
    ];
    const sorted = sortContributions(records).map((r) => r.contribution.id);
    expect(sorted).toEqual(['no-order', 'ordered']);
  });
});
