import type { ThemeDefinition, ThemeBackgroundType, ThemeGradientDirection } from './types';
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
  // Clear background effect attributes
  root.removeAttribute('data-bg-type');
  root.removeAttribute('data-surface-transparency');
  root.removeAttribute('data-backdrop-blur');
  root.removeAttribute('data-noise-opacity');
  root.removeAttribute('data-particle-density');
  root.removeAttribute('data-animation-speed');
  root.style.removeProperty('--surface-transparency');
  // Clear body class
  const body = document.body;
  for (const cls of ['bg-gradient', 'bg-mesh', 'bg-noise', 'bg-particles', 'glass-surfaces']) {
    body.classList.remove(cls);
  }
  const prevBodyClass = root.getAttribute('data-body-class');
  if (prevBodyClass) {
    prevBodyClass.split(' ').forEach((cls) => body.classList.remove(cls));
    root.removeAttribute('data-body-class');
  }
}

export interface ApplyThemeOptions {
  /** Target element, defaults to document.documentElement. */
  root?: HTMLElement;
}

export function applyTheme(theme: ThemeDefinition, options: ApplyThemeOptions = {}): void {
  const root = options.root ?? document.documentElement;
  const body = document.body;

  clearInlineTheme(root);

  root.classList.toggle('dark', theme.base === 'dark');
  root.classList.toggle('high-contrast', theme.id === 'high-contrast');
  root.setAttribute('data-theme', theme.id);
  root.style.colorScheme = theme.base;

  // Apply custom CSS variables
  if (theme.variables) {
    for (const [name, value] of Object.entries(theme.variables)) {
      if (!name.startsWith('--') || typeof value !== 'string') continue;
      root.style.setProperty(name, value);
      appliedVariables.push(name);
    }
  }

  // Apply radius
  if (typeof theme.radius === 'number' && Number.isFinite(theme.radius)) {
    root.style.setProperty('--radius', `${theme.radius}rem`);
  }

  // Apply font size
  if (typeof theme.fontSize === 'number' && Number.isFinite(theme.fontSize)) {
    root.style.fontSize = `${theme.fontSize}px`;
  }

  // Apply spacing
  if (typeof theme.spacing === 'number' && Number.isFinite(theme.spacing)) {
    root.style.setProperty('--spacing', `${theme.spacing}rem`);
  }

  // Apply font family
  if (typeof theme.fontFamily === 'string' && FONT_FAMILY_STACKS[theme.fontFamily]) {
    root.style.setProperty('font-family', FONT_FAMILY_STACKS[theme.fontFamily]);
  }

  // Apply animation speed
  const animationSpeed = theme.animationSpeed ?? 'normal';
  root.setAttribute('data-animation-speed', animationSpeed);
  body.classList.toggle('animate-none', animationSpeed === 'none');
  body.classList.toggle('animate-slow', animationSpeed === 'slow');
  body.classList.toggle('animate-fast', animationSpeed === 'fast');

  // Apply background type
  const bgType = theme.backgroundType ?? 'solid';
  root.setAttribute('data-bg-type', bgType);

  // Remove old bg classes
  body.classList.remove('bg-gradient', 'bg-mesh', 'bg-noise', 'bg-particles');

  // Apply specific background classes
  if (bgType === 'gradient') {
    body.classList.add('bg-gradient');
    const dir = theme.gradientDirection ?? 'to-br';
    root.style.setProperty('--gradient-dir', dir);
    if (theme.gradientColors && theme.gradientColors.length >= 2) {
      root.style.setProperty('--bg-gradient-start', theme.gradientColors[0]);
      root.style.setProperty('--bg-gradient-mid', theme.gradientColors[1] ?? theme.gradientColors[0]);
      root.style.setProperty('--bg-gradient-end', theme.gradientColors[2] ?? theme.gradientColors[1] ?? theme.gradientColors[0]);
    }
  } else if (bgType === 'mesh') {
    body.classList.add('bg-mesh');
    if (theme.gradientColors && theme.gradientColors.length >= 2) {
      root.style.setProperty('--bg-mesh-color-1', theme.gradientColors[0]);
      root.style.setProperty('--bg-mesh-color-2', theme.gradientColors[1] ?? theme.gradientColors[0]);
      root.style.setProperty('--bg-mesh-color-3', theme.gradientColors[2] ?? theme.gradientColors[1] ?? theme.gradientColors[0]);
    }
  } else if (bgType === 'noise') {
    body.classList.add('bg-noise');
    root.style.setProperty('--bg-noise-opacity', String(theme.noiseOpacity ?? 0.03));
  } else if (bgType === 'particles') {
    body.classList.add('bg-particles');
    root.style.setProperty('--bg-particle-density', String(theme.particleDensity ?? 30));
  }

  // Apply surface transparency
  const surfaceTransparency = typeof theme.surfaceTransparency === 'number' ? theme.surfaceTransparency : 1;
  root.setAttribute('data-surface-transparency', String(surfaceTransparency));
  root.style.setProperty('--surface-transparency', String(surfaceTransparency));
  body.classList.toggle('glass-surfaces', surfaceTransparency < 0.95);

  // Apply backdrop blur
  const backdropBlur = typeof theme.backdropBlur === 'number' ? theme.backdropBlur : 0;
  root.setAttribute('data-backdrop-blur', String(backdropBlur));
  if (backdropBlur > 0) {
    root.style.setProperty('--glass-blur', `${backdropBlur}px`);
  } else {
    root.style.removeProperty('--glass-blur');
  }

  // Apply noise opacity
  const noiseOpacity = typeof theme.noiseOpacity === 'number' ? theme.noiseOpacity : 0;
  root.setAttribute('data-noise-opacity', String(noiseOpacity));

  // Apply particle density
  const particleDensity = typeof theme.particleDensity === 'number' ? theme.particleDensity : 0;
  root.setAttribute('data-particle-density', String(particleDensity));

  // Apply custom body class (and clean up a previous theme's class first so
  // switching to a theme without a bodyClass does not leave stale styles).
  const prevBodyClass = root.getAttribute('data-body-class');
  if (prevBodyClass) {
    prevBodyClass.split(' ').forEach((cls) => body.classList.remove(cls));
    root.removeAttribute('data-body-class');
  }
  if (theme.bodyClass) {
    root.setAttribute('data-body-class', theme.bodyClass);
    theme.bodyClass.split(' ').forEach((cls) => body.classList.add(cls));
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
  document.body.classList.remove('animate-none', 'animate-slow', 'animate-fast',
    'bg-gradient', 'bg-mesh', 'bg-noise', 'bg-particles', 'glass-surfaces');
}
