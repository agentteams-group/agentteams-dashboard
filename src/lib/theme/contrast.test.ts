import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import fc from 'fast-check';

// UI-05 / task 8.6: the core text-level token pairs of all three built-in
// themes must satisfy WCAG AA (≥ 4.5:1). The values are parsed straight
// from globals.css so a token regression fails here, not in production.

const CSS = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

function section(selector: string): Record<string, string> {
  const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\}`);
  const m = CSS.match(re);
  if (!m) throw new Error(`section ${selector} not found`);
  const vars: Record<string, string> = {};
  for (const vm of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
    vars[vm[1]] = vm[2].trim();
  }
  return vars;
}

// ── color parsing ───────────────────────────────────────────────────────────

function oklchToLinearSrgb(L: number, C: number, Hd: number): [number, number, number] {
  const hr = (Hd * Math.PI) / 180;
  const a = C * Math.cos(hr);
  const b = C * Math.sin(hr);
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;
  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}

function linearToSrgb(c: number): number {
  const v = c <= 0 ? 0 : c >= 1 ? 1 : c;
  return v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055;
}

function parseColor(raw: string): [number, number, number] {
  const v = raw.trim();
  if (v.startsWith('#')) {
    const hex = v.slice(1);
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex.slice(0, 6);
    return [
      parseInt(full.slice(0, 2), 16) / 255,
      parseInt(full.slice(2, 4), 16) / 255,
      parseInt(full.slice(4, 6), 16) / 255,
    ];
  }
  const m = v.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)/);
  if (!m) throw new Error(`unsupported color: ${v}`);
  const [r, g, b] = oklchToLinearSrgb(parseFloat(m[1]), parseFloat(m[2]), parseFloat(m[3]));
  return [linearToSrgb(r), linearToSrgb(g), linearToSrgb(b)];
}

function luminance(rgb: [number, number, number]): number {
  const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(fgRaw: string, bgRaw: string): number {
  const l1 = luminance(parseColor(fgRaw));
  const l2 = luminance(parseColor(bgRaw));
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

// ── helpers sanity (WCAG anchors) ───────────────────────────────────────────

describe('contrast helper', () => {
  it('matches WCAG anchor values', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBeCloseTo(21, 1);
    expect(contrastRatio('#767676', '#ffffff')).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio('#767676', '#ffffff')).toBeLessThan(4.6);
  });

  it('achromatic contrast is symmetric, bounded, and extreme pairs pass AA (property)', () => {
    const arbL = fc
      .double({ min: 0, max: 1, noNaN: true })
      .map((x) => Math.round(x * 1e4) / 1e4);
    fc.assert(
      fc.property(arbL, arbL, (a, b) => {
        const ratio = contrastRatio(`oklch(${a} 0 0)`, `oklch(${b} 0 0)`);
        // Symmetry — the WCAG ratio is direction-independent.
        expect(ratio).toBeCloseTo(contrastRatio(`oklch(${b} 0 0)`, `oklch(${a} 0 0)`), 6);
        // Bounded by the black/white extremes.
        expect(ratio).toBeGreaterThanOrEqual(1);
        expect(ratio).toBeLessThanOrEqual(21);
      }),
      { numRuns: 500 },
    );
    // Any light-gray ≥ 0.75 on any near-black ≤ 0.25 clears AA — the
    // envelope our muted/foreground token pairs stay inside.
    fc.assert(
      fc.property(arbL, arbL, (a, b) => {
        fc.pre(a >= 0.75 && b <= 0.25);
        expect(contrastRatio(`oklch(${a} 0 0)`, `oklch(${b} 0 0)`)).toBeGreaterThanOrEqual(4.5);
      }),
      { numRuns: 500 },
    );
  });
});

// ── theme token assertions ──────────────────────────────────────────────────

const TEXT_PAIRS: [string, string][] = [
  ['--foreground', '--background'],
  ['--muted-foreground', '--background'],
  ['--muted-foreground', '--card'],
  ['--primary-foreground', '--primary'],
  ['--secondary-foreground', '--secondary'],
  ['--accent-foreground', '--accent'],
  ['--card-foreground', '--card'],
];

describe.each([
  ['light', ':root'],
  ['dark', '.dark'],
  ['high-contrast', '.high-contrast'],
] as const)('%s theme tokens (UI-05)', (_, selector) => {
  const vars = section(selector);

  it.each(TEXT_PAIRS)('%s on %s is WCAG AA (≥ 4.5:1)', (fg, bg) => {
    const ratio = contrastRatio(vars[fg], vars[bg]);
    if (ratio < 4.5) {
      throw new Error(`${fg} (${vars[fg]}) on ${bg} (${vars[bg]}) = ${ratio.toFixed(2)}:1`);
    }
  });
});

// ── 语义状态色（方案 v3 A-1/A-2）─────────────────────────────────────────────
// 徽章文本直接落在卡片上，所以按 --card 断言；底/边是同一色的淡染，只会更高。
// 三套主题必须各有一条：高对比主题不是「更淡的暗色」，它要过 AAA。
const STATUS_TOKENS = [
  '--status-running',
  '--status-waiting',
  '--status-blocked',
  '--status-done',
  '--status-failed',
  '--status-info',
];

describe.each([
  ['light', ':root', 4.5],
  ['dark', '.dark', 4.5],
  ['high-contrast', '.high-contrast', 7],
] as const)('%s theme status tokens (A-2)', (_, selector, minRatio) => {
  const vars = section(selector);

  it.each(STATUS_TOKENS)(`%s on --card ≥ ${minRatio}:1`, (token) => {
    const value = vars[token];
    if (!value) throw new Error(`${selector} 缺 ${token}（三套主题必须同集）`);
    const ratio = contrastRatio(value, vars['--card']);
    if (ratio < minRatio) {
      throw new Error(`${token} (${value}) on --card (${vars['--card']}) = ${ratio.toFixed(2)}:1`);
    }
  });
});

it('语义状态色已映射成 Tailwind 颜色，组件侧才有单轨可走（A-1）', () => {
  const themeInline = section('@theme inline');
  for (const token of STATUS_TOKENS) {
    expect(themeInline[token.replace(/^--/, '--color-')]).toBe(`var(${token})`);
  }
});
