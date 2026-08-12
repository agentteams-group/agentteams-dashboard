import { beforeEach, describe, expect, it } from 'vitest';
import { buildThemeInitScript } from './init-script';
import { THEME_STORAGE_KEY } from './types';

/**
 * The init script runs before React hydration; executing it here against the
 * jsdom document verifies the anti-flash behavior end to end.
 */

function runScript(storageValue: string | null, prefersDark = false) {
  localStorage.clear();
  if (storageValue !== null) {
    localStorage.setItem(THEME_STORAGE_KEY, storageValue);
  }
  // jsdom's matchMedia exists but always reports matches=false; override to
  // control the system preference.
  const original = window.matchMedia;
  window.matchMedia = ((query: string) => ({
    matches: prefersDark && query.includes('dark'),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    onchange: null,
    dispatchEvent: () => false,
  })) as typeof window.matchMedia;

  const script = buildThemeInitScript(THEME_STORAGE_KEY);
  // Executing the generated inline script is the test target.
  eval(script);
  window.matchMedia = original;
}

describe('buildThemeInitScript', () => {
  beforeEach(() => {
    document.documentElement.className = '';
    document.documentElement.removeAttribute('data-theme');
    document.documentElement.style.cssText = '';
    localStorage.clear();
  });

  it('is syntactically valid javascript', () => {
    expect(() => new Function(buildThemeInitScript(THEME_STORAGE_KEY))).not.toThrow();
  });

  it('defaults to dark (app default) when nothing is persisted and OS is dark', () => {
    runScript(null, true);
    expect(document.documentElement.classList.contains('dark')).toBe(true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
  });

  it('applies the light theme when persisted', () => {
    runScript(JSON.stringify({ state: { themeId: 'light', customThemes: [] }, version: 0 }));
    const root = document.documentElement;
    expect(root.classList.contains('dark')).toBe(false);
    expect(root.getAttribute('data-theme')).toBe('light');
    expect(root.style.colorScheme).toBe('light');
  });

  it('applies high-contrast classes', () => {
    runScript(JSON.stringify({ state: { themeId: 'high-contrast', customThemes: [] }, version: 0 }));
    const root = document.documentElement;
    expect(root.classList.contains('dark')).toBe(true);
    expect(root.classList.contains('high-contrast')).toBe(true);
  });

  it('applies custom theme variables, radius and font size', () => {
    runScript(
      JSON.stringify({
        state: {
          themeId: 'brand',
          customThemes: [
            {
              id: 'brand',
              name: 'Brand',
              base: 'dark',
              variables: { '--primary': '#1677ff' },
              radius: 0.75,
              fontSize: 18,
            },
          ],
        },
        version: 0,
      })
    );
    const root = document.documentElement;
    expect(root.style.getPropertyValue('--primary')).toBe('#1677ff');
    expect(root.style.getPropertyValue('--radius')).toBe('0.75rem');
    expect(root.style.fontSize).toBe('18px');
    expect(root.classList.contains('dark')).toBe(true);
  });

  it('follows the system preference when themeId is system', () => {
    runScript(JSON.stringify({ state: { themeId: 'system' }, version: 0 }), false);
    expect(document.documentElement.getAttribute('data-theme')).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);

    runScript(JSON.stringify({ state: { themeId: 'system' }, version: 0 }), true);
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark');
    expect(document.documentElement.classList.contains('dark')).toBe(true);
  });

  it('survives corrupted storage without throwing', () => {
    expect(() => runScript('{broken')).not.toThrow();
    // The script bails out inside its try/catch: nothing applied, no crash.
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
  });
});
