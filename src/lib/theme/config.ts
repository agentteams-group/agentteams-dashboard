import type { ExportedTheme, ThemeBase, ThemeDefinition, ThemeFontFamily } from './types';
import { RADIUS_BOUNDS, FONT_SIZE_BOUNDS, SPACING_BOUNDS } from './types';

const FONT_FAMILY_VALUES: ThemeFontFamily[] = ['geist', 'system', 'serif', 'mono'];

/**
 * Validation / normalization shared by JSON import and enterprise
 * theme.config.json injection.
 */

const ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;

export class ThemeConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ThemeConfigError';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/**
 * Normalizes an unknown object into a ThemeDefinition.
 * Throws ThemeConfigError with a human readable message when invalid.
 */
export function normalizeThemeDefinition(
  input: unknown,
  options: { allowBuiltin?: boolean; allowEnterprise?: boolean } = {}
): ThemeDefinition {
  if (!isRecord(input)) {
    throw new ThemeConfigError('主题配置必须是 JSON 对象');
  }

  const id = input.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new ThemeConfigError('主题 id 只能包含小写字母、数字、"-" 和 "_"，且以字母/数字开头');
  }

  const base = input.base;
  if (base !== 'light' && base !== 'dark') {
    throw new ThemeConfigError('主题 base 必须是 "light" 或 "dark"');
  }

  let name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : id;
  if (name.length > 64) name = name.slice(0, 64);

  const theme: ThemeDefinition = { id, name, base: base as ThemeBase };

  const nameZh = input.nameZh;
  if (typeof nameZh === 'string' && nameZh.trim()) theme.nameZh = nameZh.trim().slice(0, 64);

  const variables = input.variables;
  if (variables !== undefined) {
    if (!isRecord(variables)) throw new ThemeConfigError('variables 必须是对象');
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(variables)) {
      if (!key.startsWith('--')) {
        throw new ThemeConfigError(`CSS 变量名必须以 "--" 开头: ${key}`);
      }
      if (typeof value !== 'string' || value.length === 0 || value.length > 256) {
        throw new ThemeConfigError(`CSS 变量值必须是非空字符串: ${key}`);
      }
      clean[key] = value;
    }
    theme.variables = clean;
  }

  if (input.radius !== undefined) {
    const radius = Number(input.radius);
    if (!Number.isFinite(radius)) throw new ThemeConfigError('radius 必须是数字 (rem)');
    theme.radius = clamp(radius, RADIUS_BOUNDS.min, RADIUS_BOUNDS.max);
  }
  if (input.fontSize !== undefined) {
    const fontSize = Number(input.fontSize);
    if (!Number.isFinite(fontSize)) throw new ThemeConfigError('fontSize 必须是数字 (px)');
    theme.fontSize = clamp(fontSize, FONT_SIZE_BOUNDS.min, FONT_SIZE_BOUNDS.max);
  }
  if (input.spacing !== undefined) {
    const spacing = Number(input.spacing);
    if (!Number.isFinite(spacing)) throw new ThemeConfigError('spacing 必须是数字 (rem)');
    theme.spacing = clamp(spacing, SPACING_BOUNDS.min, SPACING_BOUNDS.max);
  }

  if (input.fontFamily !== undefined) {
    const family = input.fontFamily;
    if (typeof family !== 'string' || !FONT_FAMILY_VALUES.includes(family as ThemeFontFamily)) {
      throw new ThemeConfigError(`fontFamily 必须是 ${FONT_FAMILY_VALUES.join(' / ')} 之一`);
    }
    theme.fontFamily = family as ThemeFontFamily;
  }

  if (options.allowBuiltin && input.builtin === true) theme.builtin = true;
  if (options.allowEnterprise && input.enterprise === true) theme.enterprise = true;

  return theme;
}

/** Parses and validates an exported theme JSON payload. */
export function parseExportedTheme(json: string): ThemeDefinition {
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    throw new ThemeConfigError('文件不是合法的 JSON');
  }
  if (!isRecord(parsed)) throw new ThemeConfigError('主题文件必须是 JSON 对象');

  const payload = parsed as Partial<ExportedTheme>;
  const candidate = payload.kind === 'agentteams-dashboard-theme' ? payload.theme : parsed;
  return normalizeThemeDefinition(candidate);
}

/** Serializes a theme into the export envelope. */
export function exportTheme(theme: ThemeDefinition): string {
  const payload: ExportedTheme = {
    kind: 'agentteams-dashboard-theme',
    version: 1,
    theme: {
      id: theme.id,
      name: theme.name,
      ...(theme.nameZh ? { nameZh: theme.nameZh } : {}),
      base: theme.base,
      ...(theme.variables && Object.keys(theme.variables).length > 0
        ? { variables: theme.variables }
        : {}),
      ...(typeof theme.radius === 'number' ? { radius: theme.radius } : {}),
      ...(typeof theme.fontSize === 'number' ? { fontSize: theme.fontSize } : {}),
      ...(typeof theme.spacing === 'number' ? { spacing: theme.spacing } : {}),
      ...(theme.fontFamily ? { fontFamily: theme.fontFamily } : {}),
    },
  };
  return JSON.stringify(payload, null, 2);
}

/** Generates a stable, unique custom theme id from a display name. */
export function slugifyThemeId(name: string, taken: Set<string>): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'custom-theme';
  let candidate = base;
  let counter = 2;
  while (taken.has(candidate)) {
    candidate = `${base}-${counter}`;
    counter += 1;
  }
  return candidate;
}
