// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { BUILTIN_THEMES, DEFAULT_THEME_ID, findBuiltinTheme, isBuiltinThemeId } from './themes';

describe('built-in themes', () => {
  it('provides light, dark and high-contrast', () => {
    const ids = BUILTIN_THEMES.map((t) => t.id);
    expect(ids).toEqual(['light', 'dark', 'high-contrast']);
  });

  it('all built-ins are flagged builtin and have a base', () => {
    for (const theme of BUILTIN_THEMES) {
      expect(theme.builtin).toBe(true);
      expect(['light', 'dark']).toContain(theme.base);
    }
  });

  it('high-contrast is dark-based', () => {
    expect(findBuiltinTheme('high-contrast')?.base).toBe('dark');
  });

  it('findBuiltinTheme returns undefined for unknown ids', () => {
    expect(findBuiltinTheme('nope')).toBeUndefined();
  });

  it('isBuiltinThemeId recognizes built-ins only', () => {
    expect(isBuiltinThemeId('light')).toBe(true);
    expect(isBuiltinThemeId('dark')).toBe(true);
    expect(isBuiltinThemeId('high-contrast')).toBe(true);
    expect(isBuiltinThemeId('custom-x')).toBe(false);
  });

  it('default theme id is a valid built-in', () => {
    expect(isBuiltinThemeId(DEFAULT_THEME_ID)).toBe(true);
  });
});
