import type { ThemeDefinition } from './types';

/**
 * Built-in themes.
 *
 * `light` and `dark` are rendered by the CSS custom properties in
 * `src/app/globals.css` (`:root` and `.dark`). `high-contrast` stacks a
 * `.high-contrast` class on top of `dark` and overrides the tokens there as
 * well, so the pre-paint inline script only needs to toggle classes.
 * Custom (user-created) themes instead set inline variables, which win over
 * any stylesheet rule.
 */
export const BUILTIN_THEMES: ThemeDefinition[] = [
  {
    id: 'light',
    name: 'Light',
    nameZh: '亮色',
    base: 'light',
    builtin: true,
  },
  {
    id: 'dark',
    name: 'Dark',
    nameZh: '暗色',
    base: 'dark',
    builtin: true,
  },
  {
    id: 'high-contrast',
    name: 'High Contrast',
    nameZh: '高对比度',
    base: 'dark',
    builtin: true,
  },
];

export const DEFAULT_THEME_ID = 'dark';

export function findBuiltinTheme(id: string): ThemeDefinition | undefined {
  return BUILTIN_THEMES.find((t) => t.id === id);
}

/** All ids that resolve purely via CSS classes (no inline variables). */
export function isBuiltinThemeId(id: string): boolean {
  return BUILTIN_THEMES.some((t) => t.id === id);
}
