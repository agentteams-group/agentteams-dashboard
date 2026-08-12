import { beforeEach, describe, expect, it } from 'vitest';
import { applyTheme, clearTheme, getAppliedVariables } from './apply';
import { BUILTIN_THEMES } from './themes';
import type { ThemeDefinition } from './types';

describe('applyTheme', () => {
  beforeEach(() => {
    clearTheme();
  });

  it('applies a light built-in theme without inline variables', () => {
    const light = BUILTIN_THEMES.find((t) => t.id === 'light')!;
    applyTheme(light);
    const root = document.documentElement;
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.style.colorScheme).toBe('light');
    expect(getAppliedVariables()).toHaveLength(0);
  });

  it('applies the dark theme with the .dark class and color-scheme', () => {
    const dark = BUILTIN_THEMES.find((t) => t.id === 'dark')!;
    applyTheme(dark);
    const root = document.documentElement;
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.getAttribute('data-theme')).toBe('dark');
    expect(root.style.colorScheme).toBe('dark');
  });

  it('marks high-contrast with both dark and high-contrast classes', () => {
    const hc = BUILTIN_THEMES.find((t) => t.id === 'high-contrast')!;
    applyTheme(hc);
    const root = document.documentElement;
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.classList.contains('high-contrast')).toBe(true);
  });

  it('writes custom variables inline and cleans them when switching away', () => {
    const custom: ThemeDefinition = {
      id: 'brand',
      name: 'Brand',
      base: 'light',
      variables: { '--primary': '#1677ff', '--background': '#fefefe' },
      radius: 0.5,
      fontSize: 15,
      spacing: 0.25,
    };
    applyTheme(custom);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--primary')).toBe('#1677ff');
    expect(root.style.getPropertyValue('--background')).toBe('#fefefe');
    expect(root.style.getPropertyValue('--radius')).toBe('0.5rem');
    expect(root.style.fontSize).toBe('15px');
    expect(root.style.getPropertyValue('--spacing')).toBe('0.25rem');
    expect(getAppliedVariables()).toEqual(expect.arrayContaining(['--primary', '--background']));

    // Switching to a built-in theme must remove every inline override.
    const light = BUILTIN_THEMES.find((t) => t.id === 'light')!;
    applyTheme(light);
    expect(root.style.getPropertyValue('--primary')).toBe('');
    expect(root.style.getPropertyValue('--background')).toBe('');
    expect(root.style.getPropertyValue('--radius')).toBe('');
    expect(root.style.fontSize).toBe('');
    expect(getAppliedVariables()).toHaveLength(0);
  });

  it('ignores malformed variable entries', () => {
    const custom = {
      id: 'weird',
      name: 'Weird',
      base: 'light',
      variables: { primary: '#fff', '--ok': '#000' },
    } as unknown as ThemeDefinition;
    applyTheme(custom);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--ok')).toBe('#000');
    expect(root.style.getPropertyValue('primary')).toBe('');
  });

  it('clearTheme removes every hook', () => {
    const dark = BUILTIN_THEMES.find((t) => t.id === 'dark')!;
    applyTheme(dark);
    clearTheme();
    const root = document.documentElement;
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.hasAttribute('data-theme')).toBe(false);
    expect(root.style.colorScheme).toBe('');
  });

  it('applies fontFamily as an inline style and clears it', () => {
    const custom: ThemeDefinition = {
      id: 'brand',
      name: 'Brand',
      base: 'light',
      fontFamily: 'system',
    };
    applyTheme(custom);
    const root = document.documentElement;
    expect(root.style.getPropertyValue('font-family')).toBe(
      'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    );

    // Switching to a built-in theme must remove the font override.
    const light = BUILTIN_THEMES.find((t) => t.id === 'light')!;
    applyTheme(light);
    expect(root.style.getPropertyValue('font-family')).toBe('');
  });
});
