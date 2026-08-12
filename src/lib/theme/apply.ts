import type { ThemeDefinition } from './types';
import { FONT_FAMILY_STACKS } from './types';

/**
 * Applies a ThemeDefinition to the document.
 *
 * Strategy:
 * - The `dark` class on <html> drives Tailwind's `dark:` variant.
 * - `high-contrast` adds the `.high-contrast` token overrides.
 * - `data-theme` records the active id (useful for CSS hooks/tests).
 * - Custom variables are written as inline styles on the root element; they
 *   win over the :root / .dark stylesheet values. All previously written
 *   inline tokens are removed first so switching back to a built-in theme is
 *   clean.
 */

/** Tokens that the applier manages as inline styles on <html>. */
const MANAGED_TOKENS = ['--radius', '--spacing'] as const;

let appliedVariables: string[] = [];

export function resetAppliedVariables(): void {
  appliedVariables = [];
}

/** Currently inline-applied custom variables (for tests/debugging). */
export function getAppliedVariables(): readonly string[] {
  return appliedVariables;
}

function clearInlineTheme(root: HTMLElement): void {
  for (const name of appliedVariables) {
    root.style.removeProperty(name);
  }
  appliedVariables = [];
  for (const token of MANAGED_TOKENS) {
    root.style.removeProperty(token);
  }
  root.style.removeProperty('font-size');
  root.style.removeProperty('font-family');
}

export interface ApplyThemeOptions {
  /** Target element, defaults to document.documentElement. */
  root?: HTMLElement;
}

export function applyTheme(theme: ThemeDefinition, options: ApplyThemeOptions = {}): void {
  const root = options.root ?? document.documentElement;

  clearInlineTheme(root);

  root.classList.toggle('dark', theme.base === 'dark');
  root.classList.toggle('high-contrast', theme.id === 'high-contrast');
  root.setAttribute('data-theme', theme.id);
  root.style.colorScheme = theme.base;

  if (theme.variables) {
    for (const [name, value] of Object.entries(theme.variables)) {
      if (!name.startsWith('--') || typeof value !== 'string') continue;
      root.style.setProperty(name, value);
      appliedVariables.push(name);
    }
  }
  if (typeof theme.radius === 'number' && Number.isFinite(theme.radius)) {
    root.style.setProperty('--radius', `${theme.radius}rem`);
  }
  if (typeof theme.fontSize === 'number' && Number.isFinite(theme.fontSize)) {
    root.style.fontSize = `${theme.fontSize}px`;
  }
  if (typeof theme.spacing === 'number' && Number.isFinite(theme.spacing)) {
    root.style.setProperty('--spacing', `${theme.spacing}rem`);
  }
  if (typeof theme.fontFamily === 'string' && FONT_FAMILY_STACKS[theme.fontFamily]) {
    root.style.setProperty('font-family', FONT_FAMILY_STACKS[theme.fontFamily]);
  }
}

/**
 * Removes every theme hook from the document (used when unmounting the
 * provider in tests).
 */
export function clearTheme(options: ApplyThemeOptions = {}): void {
  const root = options.root ?? document.documentElement;
  clearInlineTheme(root);
  root.classList.remove('dark', 'high-contrast');
  root.removeAttribute('data-theme');
  root.style.removeProperty('color-scheme');
}
