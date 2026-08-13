/**
 * Theme system types.
 *
 * The Dashboard follows the shadcn/ui CSS variable naming convention
 * (--primary, --background, ...) so existing components keep working.
 * A theme is a bundle of:
 *   - base mode (light/dark) driving the `.dark` class + color-scheme
 *   - optional CSS custom-property overrides (any `--xxx` token)
 *   - optional radius / font-size / spacing scale overrides
 *   - optional background effects (gradient, mesh, noise, particles)
 *   - optional animation speed controls
 *   - optional transparency / blur overrides for surfaces
 */

/** Base color mode. Drives Tailwind's `dark:` variant and `color-scheme`. */
export type ThemeBase = 'light' | 'dark';

/** Font family preset to apply to the root element. */
export type ThemeFontFamily = 'geist' | 'system' | 'serif' | 'mono';

/** Animation speed preset for UI transitions. */
export type ThemeAnimationSpeed = 'none' | 'slow' | 'normal' | 'fast';

/** Background effect type for the root element. */
export type ThemeBackgroundType = 'solid' | 'gradient' | 'mesh' | 'noise' | 'particles';

/** Gradient direction preset. */
export type ThemeGradientDirection =
  | 'to-t' | 'to-tr' | 'to-r' | 'to-br' | 'to-b' | 'to-bl' | 'to-l' | 'to-tl'
  | 'from-t' | 'from-tr' | 'from-r' | 'from-br' | 'from-b' | 'from-bl' | 'from-l' | 'from-tl'
  | 'radial' | 'conic';

/** Font stack strings for each preset. */
export const FONT_FAMILY_STACKS: Record<ThemeFontFamily, string> = {
  geist: 'var(--font-geist-sans), ui-sans-serif, system-ui, sans-serif',
  system: 'ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
  serif: 'ui-serif, Georgia, Cambria, "Times New Roman", Times, serif',
  mono: 'var(--font-geist-mono), ui-monospace, "Cascadia Code", "Source Code Pro", Menlo, monospace',
};

export const FONT_FAMILY_LABELS: Record<ThemeFontFamily, string> = {
  geist: 'Geist（默认）',
  system: '系统字',
  serif: '衬线体',
  mono: '等宽体',
};

/** Special theme id that follows the OS prefers-color-scheme setting. */
export const SYSTEM_THEME_ID = 'system';

/** localStorage key holding the persisted theme selection (zustand persist). */
export const THEME_STORAGE_KEY = 'agentteams-theme';

export interface ThemeDefinition {
  /** Stable id, e.g. 'light', 'dark', 'high-contrast', 'my-brand'. */
  id: string;
  /** Display name (defaults to English). */
  name: string;
  /** Chinese display name; falls back to `name`. */
  nameZh?: string;
  /** Base mode of the theme. */
  base: ThemeBase;
  /** Built-in themes cannot be edited or deleted by users. */
  builtin?: boolean;
  /**
   * CSS custom property overrides applied on `document.documentElement`.
   * Keys must start with `--`. Values are used verbatim (hex/oklch/...).
   */
  variables?: Record<string, string>;
  /** Corner radius in rem (maps to `--radius`). */
  radius?: number;
  /** Root font size in px (applied to `<html>` so rem units scale). */
  fontSize?: number;
  /** Spacing scale base in rem (maps to Tailwind v4 `--spacing`, default 0.25). */
  spacing?: number;
  /** Enterprise themes pushed via theme.config.json cannot be removed by users. */
  enterprise?: boolean;
  /** Font family preset applied to the root element. */
  fontFamily?: ThemeFontFamily;
  /** Animation speed for UI transitions and effects. */
  animationSpeed?: ThemeAnimationSpeed;
  /** Background effect type applied to the body/root element. */
  backgroundType?: ThemeBackgroundType;
  /** Gradient colors for background effects. [start, mid, end] or [color1, color2]. */
  gradientColors?: string[];
  /** Gradient direction for linear gradients. */
  gradientDirection?: ThemeGradientDirection;
  /** Transparency factor for card/surface backgrounds (0 = fully transparent, 1 = opaque). */
  surfaceTransparency?: number;
  /** Blur amount for glassmorphic surfaces (0 = none, up to 40px). */
  backdropBlur?: number;
  /** Noise texture opacity (0 = hidden, 1 = full opacity). */
  noiseOpacity?: number;
  /** Particle density for particle background (0 = hidden, up to 100). */
  particleDensity?: number;
  /** Custom CSS class to apply to the body element. */
  bodyClass?: string;
}

/**
 * Full set of editable color keys. The flat array is preserved for backwards
 * compatibility with tests; `EDITABLE_COLOR_GROUPS` renders the grouped editor.
 */
export const EDITABLE_COLOR_KEYS = [
  'primary',
  'primary-foreground',
  'background',
  'foreground',
  'card',
  'card-foreground',
  'popover',
  'popover-foreground',
  'secondary',
  'secondary-foreground',
  'muted',
  'muted-foreground',
  'accent',
  'accent-foreground',
  'destructive',
  'destructive-foreground',
  'border',
  'input',
  'ring',
  'chart-1',
  'chart-2',
  'chart-3',
  'chart-4',
  'chart-5',
  'sidebar',
  'sidebar-foreground',
  'sidebar-primary',
  'sidebar-primary-foreground',
  'sidebar-accent',
  'sidebar-accent-foreground',
  'sidebar-border',
  'sidebar-ring',
] as const;

export type EditableColorKey = (typeof EDITABLE_COLOR_KEYS)[number];

/** Grouped color sections for the editor UI. Each entry is a label + key subset. */
export interface ColorGroup {
  label: string;
  keys: EditableColorKey[];
}

export const EDITABLE_COLOR_GROUPS: ColorGroup[] = [
  { label: '核心颜色', keys: ['primary', 'primary-foreground', 'background', 'foreground'] },
  { label: '表面颜色', keys: ['card', 'card-foreground', 'popover', 'popover-foreground'] },
  { label: '辅助颜色', keys: ['secondary', 'secondary-foreground', 'muted', 'muted-foreground', 'accent', 'accent-foreground'] },
  { label: '表单与边框', keys: ['border', 'input', 'ring', 'destructive', 'destructive-foreground'] },
  { label: '侧边栏', keys: ['sidebar', 'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground', 'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border', 'sidebar-ring'] },
  { label: '图表颜色', keys: ['chart-1', 'chart-2', 'chart-3', 'chart-4', 'chart-5'] },
];

/** Human-readable labels (zh) for editor controls. */
export const EDITABLE_COLOR_LABELS: Record<EditableColorKey, string> = {
  primary: '主色',
  'primary-foreground': '主色前景',
  background: '背景色',
  foreground: '文字色',
  card: '卡片背景',
  'card-foreground': '卡片文字',
  popover: '弹出层背景',
  'popover-foreground': '弹出层文字',
  secondary: '次要色',
  'secondary-foreground': '次要前景',
  muted: '弱化背景',
  'muted-foreground': '次要文字',
  accent: '强调色',
  'accent-foreground': '强调前景',
  destructive: '危险色',
  'destructive-foreground': '危险前景',
  border: '边框色',
  input: '输入框色',
  ring: '焦点环',
  'chart-1': '图表 1',
  'chart-2': '图表 2',
  'chart-3': '图表 3',
  'chart-4': '图表 4',
  'chart-5': '图表 5',
  sidebar: '侧边栏背景',
  'sidebar-foreground': '侧边栏文字',
  'sidebar-primary': '侧边栏主色',
  'sidebar-primary-foreground': '侧边栏主前景',
  'sidebar-accent': '侧边栏强调',
  'sidebar-accent-foreground': '侧边栏强调前景',
  'sidebar-border': '侧边栏边框',
  'sidebar-ring': '侧边栏焦点环',
};

export interface RadiusBound {
  min: number;
  max: number;
  step: number;
}

export interface FontSizeBound {
  min: number;
  max: number;
  step: number;
}

export const RADIUS_BOUNDS: RadiusBound = { min: 0, max: 1.5, step: 0.05 };
export const FONT_SIZE_BOUNDS: FontSizeBound = { min: 13, max: 20, step: 1 };
export const SPACING_BOUNDS: RadiusBound = { min: 0.2, max: 0.35, step: 0.005 };

/** Payload exchanged via JSON import/export. */
export interface ExportedTheme {
  $schema?: string;
  kind: 'agentteams-dashboard-theme';
  version: 1;
  theme: ThemeDefinition;
}

/** Enterprise configuration served from /api/dashboard/theme. */
export interface EnterpriseThemeConfig {
  /** Additional themes injected into the picker. */
  themes: ThemeDefinition[];
  /** Default theme id used when the user has not chosen one. */
  defaultTheme?: string;
  /** When true the user cannot switch away from `defaultTheme`. */
  locked?: boolean;
}
