// @vitest-environment node
import { describe, expect, it } from 'vitest';
import {
  normalizeThemeDefinition,
  parseExportedTheme,
  exportTheme,
  slugifyThemeId,
  ThemeConfigError,
} from './config';
import type { ThemeDefinition } from './types';

describe('normalizeThemeDefinition', () => {
  it('accepts a minimal valid theme', () => {
    const theme = normalizeThemeDefinition({ id: 'brand', base: 'light' });
    expect(theme).toMatchObject({ id: 'brand', name: 'brand', base: 'light' });
  });

  it('uses id as fallback name and trims long names', () => {
    const theme = normalizeThemeDefinition({
      id: 'x1',
      base: 'dark',
      name: '  '.repeat(40),
    });
    expect(theme.name).toBe('x1');
  });

  it('rejects invalid ids', () => {
    for (const id of ['Dark', '-lead', 'has space', '', 'x'.repeat(70), 'a/b']) {
      expect(() => normalizeThemeDefinition({ id, base: 'light' })).toThrow(ThemeConfigError);
    }
  });

  it('rejects invalid base', () => {
    expect(() => normalizeThemeDefinition({ id: 'a', base: 'blue' })).toThrow(/base/);
  });

  it('rejects non-object input', () => {
    expect(() => normalizeThemeDefinition(null)).toThrow(ThemeConfigError);
    expect(() => normalizeThemeDefinition('theme')).toThrow(ThemeConfigError);
  });

  it('normalizes variables and rejects invalid css keys', () => {
    const theme = normalizeThemeDefinition({
      id: 'a',
      base: 'light',
      variables: { '--primary': '#ff0000' },
    });
    expect(theme.variables).toEqual({ '--primary': '#ff0000' });

    expect(() =>
      normalizeThemeDefinition({ id: 'a', base: 'light', variables: { primary: '#fff' } })
    ).toThrow(/--/);
    expect(() =>
      normalizeThemeDefinition({ id: 'a', base: 'light', variables: { '--x': '' } })
    ).toThrow(ThemeConfigError);
  });

  it('clamps radius / fontSize / spacing into bounds', () => {
    const theme = normalizeThemeDefinition({
      id: 'a',
      base: 'light',
      radius: 99,
      fontSize: 99,
      spacing: 99,
    });
    expect(theme.radius).toBeLessThanOrEqual(1.5);
    expect(theme.fontSize).toBeLessThanOrEqual(20);
    expect(theme.spacing).toBeLessThanOrEqual(0.35);
  });

  it('normalizes fontFamily and rejects invalid values', () => {
    for (const family of ['geist', 'system', 'serif', 'mono'] as const) {
      const theme = normalizeThemeDefinition({ id: 'a', base: 'light', fontFamily: family });
      expect(theme.fontFamily).toBe(family);
    }
    expect(() => normalizeThemeDefinition({ id: 'a', base: 'light', fontFamily: 'bold' })).toThrow(
      /fontFamily/
    );
  });

  it('rejects non-numeric radius', () => {
    expect(() => normalizeThemeDefinition({ id: 'a', base: 'light', radius: 'big' })).toThrow(
      ThemeConfigError
    );
  });

  it('only honors builtin/enterprise flags when allowed', () => {
    const strict = normalizeThemeDefinition({ id: 'a', base: 'light', builtin: true });
    expect(strict.builtin).toBeUndefined();
    const allowed = normalizeThemeDefinition({ id: 'a', base: 'light', builtin: true }, { allowBuiltin: true });
    expect(allowed.builtin).toBe(true);
  });
});

describe('exportTheme / parseExportedTheme round-trip', () => {
  const source: ThemeDefinition = {
    id: 'brand',
    name: 'Brand',
    nameZh: '品牌',
    base: 'dark',
    variables: { '--primary': '#123456' },
    radius: 0.5,
    fontSize: 15,
  };

  it('round-trips a theme through JSON', () => {
    const json = exportTheme(source);
    const parsed = parseExportedTheme(json);
    expect(parsed).toEqual(source);
  });

  it('rejects invalid JSON text', () => {
    expect(() => parseExportedTheme('{oops')).toThrow(/JSON/);
  });

  it('rejects non-object JSON', () => {
    expect(() => parseExportedTheme('[1,2]')).toThrow(ThemeConfigError);
  });

  it('accepts a bare theme document without envelope', () => {
    const parsed = parseExportedTheme(JSON.stringify({ id: 'bare', base: 'light' }));
    expect(parsed.id).toBe('bare');
  });

  it('rejects envelopes with broken inner theme', () => {
    const bad = JSON.stringify({ kind: 'agentteams-dashboard-theme', version: 1, theme: { id: 'X', base: 'light' } });
    expect(() => parseExportedTheme(bad)).toThrow(ThemeConfigError);
  });
});

describe('slugifyThemeId', () => {
  it('creates stable slugs and avoids collisions', () => {
    const taken = new Set<string>();
    const first = slugifyThemeId('My Theme!', taken);
    expect(first).toBe('my-theme');
    taken.add(first);
    const second = slugifyThemeId('My Theme', taken);
    expect(second).toBe('my-theme-2');
  });

  it('falls back for names without ascii chars', () => {
    expect(slugifyThemeId('主题', new Set())).toBe('custom-theme');
  });
});
