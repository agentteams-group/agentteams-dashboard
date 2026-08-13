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

describe('normalizeThemeDefinition - visual effects', () => {
  it('accepts animationSpeed', () => {
    const t = normalizeThemeDefinition({ id: 't1', base: 'dark', animationSpeed: 'slow' });
    expect(t.animationSpeed).toBe('slow');
  });

  it('rejects invalid animationSpeed', () => {
    expect(() => normalizeThemeDefinition({ id: 't1', base: 'dark', animationSpeed: 'ultra' }))
      .toThrow(ThemeConfigError);
  });

  it('accepts backgroundType', () => {
    const t = normalizeThemeDefinition({ id: 't1', base: 'dark', backgroundType: 'gradient' });
    expect(t.backgroundType).toBe('gradient');
  });

  it('rejects invalid backgroundType', () => {
    expect(() => normalizeThemeDefinition({ id: 't1', base: 'dark', backgroundType: 'fire' }))
      .toThrow(ThemeConfigError);
  });

  it('accepts gradientColors with valid hex colors', () => {
    const t = normalizeThemeDefinition({ id: 't1', base: 'dark', gradientColors: ['#ff0000', '#00ff00'] });
    expect(t.gradientColors).toEqual(['#ff0000', '#00ff00']);
  });

  it('rejects gradientColors with fewer than 2 entries', () => {
    expect(() => normalizeThemeDefinition({ id: 't1', base: 'dark', gradientColors: ['#ff0000'] }))
      .toThrow(ThemeConfigError);
  });

  it('accepts gradientDirection', () => {
    const t = normalizeThemeDefinition({ id: 't1', base: 'dark', gradientDirection: 'radial' });
    expect(t.gradientDirection).toBe('radial');
  });

  it('accepts surfaceTransparency', () => {
    const t = normalizeThemeDefinition({ id: 't1', base: 'dark', surfaceTransparency: 0.5 });
    expect(t.surfaceTransparency).toBe(0.5);
  });

  it('rejects surfaceTransparency out of range', () => {
    expect(() => normalizeThemeDefinition({ id: 't1', base: 'dark', surfaceTransparency: 1.5 }))
      .toThrow(ThemeConfigError);
  });

  it('accepts backdropBlur', () => {
    const t = normalizeThemeDefinition({ id: 't1', base: 'dark', backdropBlur: 12 });
    expect(t.backdropBlur).toBe(12);
  });

  it('accepts noiseOpacity', () => {
    const t = normalizeThemeDefinition({ id: 't1', base: 'dark', noiseOpacity: 0.05 });
    expect(t.noiseOpacity).toBe(0.05);
  });

  it('accepts particleDensity', () => {
    const t = normalizeThemeDefinition({ id: 't1', base: 'dark', particleDensity: 50 });
    expect(t.particleDensity).toBe(50);
  });

  it('accepts bodyClass', () => {
    const t = normalizeThemeDefinition({ id: 't1', base: 'dark', bodyClass: 'my-custom-theme' });
    expect(t.bodyClass).toBe('my-custom-theme');
  });

  it('rejects invalid bodyClass', () => {
    expect(() => normalizeThemeDefinition({ id: 't1', base: 'dark', bodyClass: '123-invalid' }))
      .toThrow(ThemeConfigError);
  });

  it('round-trips visual effect fields through export/import', () => {
    const original: ThemeDefinition = {
      id: 'fx-test',
      name: 'FX Test',
      base: 'dark',
      animationSpeed: 'fast',
      backgroundType: 'gradient',
      gradientColors: ['#10b981', '#3b82f6'],
      gradientDirection: 'to-br',
      surfaceTransparency: 0.7,
      backdropBlur: 16,
      noiseOpacity: 0.03,
      particleDensity: 40,
      bodyClass: 'glass-body',
    };
    const exported = JSON.parse(exportTheme(original));
    const restored = parseExportedTheme(JSON.stringify(exported));
    expect(restored.animationSpeed).toBe('fast');
    expect(restored.backgroundType).toBe('gradient');
    expect(restored.gradientColors).toEqual(['#10b981', '#3b82f6']);
    expect(restored.gradientDirection).toBe('to-br');
    expect(restored.surfaceTransparency).toBe(0.7);
    expect(restored.backdropBlur).toBe(16);
    expect(restored.noiseOpacity).toBe(0.03);
    expect(restored.particleDensity).toBe(40);
    expect(restored.bodyClass).toBe('glass-body');
  });
});
