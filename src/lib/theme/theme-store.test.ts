import { beforeEach, describe, expect, it } from 'vitest';
import { resolveTheme, selectAvailableThemes, useThemeStore } from './theme-store';
import { BUILTIN_THEMES } from './themes';
import { SYSTEM_THEME_ID } from './types';
import type { ThemeDefinition } from './types';
import { normalizeThemeSchedule, SCHEDULED_THEME_ID } from './schedule';

function resetStore() {
  useThemeStore.setState({
    themeId: SYSTEM_THEME_ID,
    themeSchedule: normalizeThemeSchedule(undefined),
    customThemes: [],
    enterpriseThemes: [],
    enterpriseDefaultTheme: null,
    enterpriseLocked: false,
    enterpriseLoaded: false,
  });
}

describe('theme store', () => {
  beforeEach(() => {
    resetStore();
    localStorage.clear();
  });

  it('retains explicit following of the system preference', () => {
    expect(useThemeStore.getState().themeId).toBe(SYSTEM_THEME_ID);
  });

  it('defaults new browser profiles to automatic day/night switching', () => {
    expect(useThemeStore.getInitialState().themeId).toBe(SCHEDULED_THEME_ID);
  });

  it('persists schedule settings and restores them without overwriting a legacy explicit choice', async () => {
    useThemeStore.getState().setThemeSchedule({ lightStart: '08:00', darkStart: '20:00', dayTheme: 'warm' });
    const stored = JSON.parse(localStorage.getItem('agentteams-theme')!);
    expect(stored.state.themeSchedule.dayTheme).toBe('warm');
    localStorage.setItem('agentteams-theme', JSON.stringify({ state: { themeId: 'dark', customThemes: [] }, version: 0 }));
    await useThemeStore.persist.rehydrate();
    expect(useThemeStore.getState().themeId).toBe('dark');
    expect(useThemeStore.getState().themeSchedule).toEqual(normalizeThemeSchedule(undefined));
  });

  it('resolves automatic schedules while retaining enterprise lock priority', () => {
    useThemeStore.setState({ themeId: SCHEDULED_THEME_ID });
    expect(resolveTheme(useThemeStore.getState(), false, 7 * 60).id).toBe('light');
    expect(resolveTheme(useThemeStore.getState(), false, 19 * 60).id).toBe('dark');
    useThemeStore.getState().setEnterpriseConfig({ themes: [], defaultTheme: 'high-contrast', locked: true });
    useThemeStore.getState().setThemeSchedule({ lightStart: '09:00', darkStart: '21:00', dayTheme: 'warm' });
    expect(useThemeStore.getState().themeSchedule.dayTheme).toBe('light');
    expect(resolveTheme(useThemeStore.getState(), false, 10 * 60).id).toBe('high-contrast');
  });

  it('setThemeId switches the selection', () => {
    useThemeStore.getState().setThemeId('light');
    expect(useThemeStore.getState().themeId).toBe('light');
  });

  it('manages custom themes (add/update/remove)', () => {
    const store = useThemeStore.getState();
    const custom: ThemeDefinition = { id: 'brand', name: 'Brand', base: 'dark' };
    store.addCustomTheme(custom);
    expect(useThemeStore.getState().customThemes).toEqual([custom]);

    // add again replaces instead of duplicating
    useThemeStore.getState().addCustomTheme({ ...custom, name: 'Brand v2' });
    expect(useThemeStore.getState().customThemes).toHaveLength(1);
    expect(useThemeStore.getState().customThemes[0].name).toBe('Brand v2');

    useThemeStore.getState().updateCustomTheme({ ...custom, name: 'Updated' });
    expect(useThemeStore.getState().customThemes[0].name).toBe('Updated');

    useThemeStore.getState().removeCustomTheme('brand');
    expect(useThemeStore.getState().customThemes).toHaveLength(0);
  });

  it('falls back to the default theme when removing the active custom theme', () => {
    const store = useThemeStore.getState();
    store.addCustomTheme({ id: 'gone', name: 'Gone', base: 'light' });
    store.setThemeId('gone');
    useThemeStore.getState().removeCustomTheme('gone');
    expect(useThemeStore.getState().themeId).toBe('light');
  });

  it('enterprise config provides themes and default', () => {
    useThemeStore.getState().setEnterpriseConfig({
      themes: [{ id: 'corp', name: 'Corp', base: 'light' }],
      defaultTheme: 'corp',
      locked: false,
    });
    const state = useThemeStore.getState();
    // user was on 'system' → enterprise default takes over
    expect(state.themeId).toBe('corp');
    expect(state.enterpriseThemes[0].enterprise).toBe(true);
  });

  it('keeps an explicit user choice over the enterprise default', () => {
    useThemeStore.getState().setThemeId('light');
    useThemeStore.getState().setEnterpriseConfig({
      themes: [{ id: 'corp', name: 'Corp', base: 'light' }],
      defaultTheme: 'corp',
    });
    expect(useThemeStore.getState().themeId).toBe('light');
  });

  it('locked enterprise config prevents switching', () => {
    useThemeStore.getState().setEnterpriseConfig({
      themes: [{ id: 'corp', name: 'Corp', base: 'light' }],
      defaultTheme: 'corp',
      locked: true,
    });
    useThemeStore.getState().setThemeId('light');
    expect(useThemeStore.getState().themeId).toBe('corp');
  });
});

describe('resolveTheme', () => {
  beforeEach(resetStore);

  const baseState = () => useThemeStore.getState();

  it('system resolves to dark when the OS prefers dark', () => {
    expect(resolveTheme(baseState(), true).id).toBe('dark');
    expect(resolveTheme(baseState(), false).id).toBe('light');
  });

  it('resolves an explicit custom theme', () => {
    useThemeStore.getState().addCustomTheme({ id: 'c1', name: 'C1', base: 'dark' });
    useThemeStore.getState().setThemeId('c1');
    expect(resolveTheme(baseState(), false).id).toBe('c1');
  });

  it('falls back to the default theme for unknown ids', () => {
    useThemeStore.setState({ themeId: 'missing-theme' });
    expect(resolveTheme(baseState(), false).id).toBe('light');
  });

  it('locked enterprise config forces the default theme', () => {
    useThemeStore.setState({
      themeId: 'light',
      enterpriseThemes: [{ id: 'corp', name: 'Corp', base: 'dark' }],
      enterpriseDefaultTheme: 'corp',
      enterpriseLocked: true,
    });
    expect(resolveTheme(baseState(), false).id).toBe('corp');
  });

  it('selectAvailableThemes orders builtin → custom → enterprise', () => {
    useThemeStore.getState().addCustomTheme({ id: 'c1', name: 'C1', base: 'light' });
    useThemeStore.getState().setEnterpriseConfig({ themes: [{ id: 'e1', name: 'E1', base: 'dark' }] });
    const themes = selectAvailableThemes(useThemeStore.getState());
    expect(themes.map((t) => t.id)).toEqual([
      ...BUILTIN_THEMES.map((t) => t.id),
      'c1',
      'e1',
    ]);
  });
});
