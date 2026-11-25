// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { parseSemVer, satisfies, compareSemVer } from './semver';
import { validatePluginManifest, PluginManifestError } from './manifest';

describe('parseSemVer', () => {
  it('parses full versions', () => {
    expect(parseSemVer('1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
  });
  it('pads missing minor/patch', () => {
    expect(parseSemVer('1')).toEqual({ major: 1, minor: 0, patch: 0 });
    expect(parseSemVer('1.2')).toEqual({ major: 1, minor: 2, patch: 0 });
  });
  it('strips v prefix and prerelease/build metadata', () => {
    expect(parseSemVer('v1.2.3')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemVer('1.2.3-beta.1')).toEqual({ major: 1, minor: 2, patch: 3 });
    expect(parseSemVer('1.2.3+build.5')).toEqual({ major: 1, minor: 2, patch: 3 });
  });
  it('rejects invalid versions', () => {
    expect(parseSemVer('abc')).toBeNull();
    expect(parseSemVer('1.x.3')).toBeNull();
    expect(parseSemVer('')).toBeNull();
    expect(parseSemVer('1.2.3.4.5')).toBeNull();
  });
  it('accepts a trailing hotfix segment and compares on the three-segment base', () => {
    expect(parseSemVer('1.2.4.9')).toEqual({ major: 1, minor: 2, patch: 4 });
    expect(satisfies('1.2.4.9', '>=1.2.4')).toBe(true);
    expect(satisfies('1.2.4.9', '<1.2.5')).toBe(true);
    expect(satisfies('1.2.4.9', '>=1.2.5')).toBe(false);
    expect(satisfies('v1.2.4.9', '1.2.x')).toBe(true);
  });
});

describe('satisfies', () => {
  const v = '0.2.0';
  it('empty / * ranges always pass', () => {
    expect(satisfies(v, undefined)).toBe(true);
    expect(satisfies(v, '')).toBe(true);
    expect(satisfies(v, '*')).toBe(true);
  });
  it('exact match', () => {
    expect(satisfies('1.2.3', '1.2.3')).toBe(true);
    expect(satisfies('1.2.3', '=1.2.3')).toBe(true);
    expect(satisfies('1.2.4', '1.2.3')).toBe(false);
  });
  it('comparators', () => {
    expect(satisfies('0.2.0', '>=0.2.0')).toBe(true);
    expect(satisfies('0.3.0', '>=0.2.0')).toBe(true);
    expect(satisfies('0.1.0', '>=0.2.0')).toBe(false);
    expect(satisfies('1.0.0', '<2.0.0')).toBe(true);
    expect(satisfies('2.0.0', '<2.0.0')).toBe(false);
    expect(satisfies('1.5.0', '>1.0.0 <2.0.0')).toBe(true);
    expect(satisfies('2.5.0', '>1.0.0 <2.0.0')).toBe(false);
  });
  it('caret ranges', () => {
    expect(satisfies('1.2.3', '^1.2.0')).toBe(true);
    expect(satisfies('1.9.9', '^1.2.0')).toBe(true);
    expect(satisfies('2.0.0', '^1.2.0')).toBe(false);
    expect(satisfies('0.2.5', '^0.2.0')).toBe(true);
    expect(satisfies('0.3.0', '^0.2.0')).toBe(false);
  });
  it('tilde ranges', () => {
    expect(satisfies('1.2.5', '~1.2.0')).toBe(true);
    expect(satisfies('1.3.0', '~1.2.0')).toBe(false);
  });
  it('x wildcards', () => {
    expect(satisfies('1.5.9', '1.x')).toBe(true);
    expect(satisfies('2.0.0', '1.x')).toBe(false);
    expect(satisfies('1.2.9', '1.2.x')).toBe(true);
    expect(satisfies('1.3.0', '1.2.x')).toBe(false);
  });
  it('OR ranges with ||', () => {
    expect(satisfies('1.0.0', '^1.0.0 || ^2.0.0')).toBe(true);
    expect(satisfies('2.5.0', '^1.0.0 || ^2.0.0')).toBe(true);
    expect(satisfies('3.0.0', '^1.0.0 || ^2.0.0')).toBe(false);
  });
  it('hyphen ranges', () => {
    expect(satisfies('1.5.0', '1.0.0 - 2.0.0')).toBe(true);
    expect(satisfies('2.5.0', '1.0.0 - 2.0.0')).toBe(false);
  });
  it('invalid version never satisfies', () => {
    expect(satisfies('not-a-version', '>=0.1.0')).toBe(false);
  });
  it('dashboard gating example', () => {
    expect(satisfies('0.2.0', '>=0.2.0')).toBe(true);
    expect(satisfies('0.1.0', '>=0.2.0')).toBe(false);
  });
});

describe('compareSemVer', () => {
  it('orders versions numerically', () => {
    expect(compareSemVer('1.2.3', '1.2.4')).toBeLessThan(0);
    expect(compareSemVer('1.10.0', '1.9.0')).toBeGreaterThan(0);
    expect(compareSemVer('1.0.0', '1.0.0')).toBe(0);
  });
});

describe('satisfies with whitespace between comparator and version (f6-1)', () => {
  // 修复前：'>= 1.0.0' 被空白拆成 ['>=', '1.0.0']，parseComparator 的正则
  // 回溯出 op='>'、target='='，Number('=')=NaN → 所有带空格写法全部 false。
  it('accepts a space after comparators', () => {
    expect(satisfies('1.5.0', '>= 1.0.0')).toBe(true);
    expect(satisfies('1.5.0', '= 1.5.0')).toBe(true);
    expect(satisfies('1.5.0', '^ 1.2.0')).toBe(true);
    expect(satisfies('1.5.0', '< 2.0.0')).toBe(true);
    expect(satisfies('1.5.0', '== 1.5.0')).toBe(true);
    // '~' 语义与无空格写法一致（patch 档范围）：>=1.2.0 <1.3.0。
    expect(satisfies('1.2.5', '~ 1.2.0')).toBe(true);
    expect(satisfies('1.5.0', '~ 1.2.0')).toBe(false);
  });

  it('boundary semantics unchanged by the space', () => {
    expect(satisfies('2.0.0', '< 2.0.0')).toBe(false);
    expect(satisfies('1.0.0', '= 1.5.0')).toBe(false);
    expect(satisfies('2.0.0', '^ 1.2.0')).toBe(false);
    expect(satisfies('0.9.0', '>= 1.0.0')).toBe(false);
  });

  it('AND group with spaced comparators', () => {
    expect(satisfies('1.5.0', '>= 1.0.0 < 2.0.0')).toBe(true);
    expect(satisfies('2.5.0', '>= 1.0.0 < 2.0.0')).toBe(false);
  });

  it('OR group with spaced comparators', () => {
    expect(satisfies('1.5.0', '>= 1.5.0 || >= 2.0.0')).toBe(true);
    expect(satisfies('2.5.0', '>= 1.5.0 || >= 2.0.0')).toBe(true);
    expect(satisfies('1.0.0', '>= 1.5.0 || >= 2.0.0')).toBe(false);
  });

  it("hyphen ranges are unaffected ('-' is not a comparator token)", () => {
    expect(satisfies('1.5.0', '1.0.0 - 2.0.0')).toBe(true);
    expect(satisfies('2.5.0', '1.0.0 - 2.0.0')).toBe(false);
  });

  it('end-to-end: a manifest declaring a spaced range passes validatePluginManifest', () => {
    const base = {
      id: 'demo',
      name: 'Demo',
      version: '1.0.0',
      entry: { dashboard: 'index.js' },
    };
    const manifest = validatePluginManifest(
      { ...base, dashboardVersion: '>= 1.0.0' },
      { dashboardVersion: '1.5.0' },
    );
    expect(manifest.dashboardVersion).toBe('>= 1.0.0');
    expect(() =>
      validatePluginManifest({ ...base, dashboardVersion: '>= 2.0.0' }, { dashboardVersion: '1.5.0' })
    ).toThrow(PluginManifestError);
  });
});
