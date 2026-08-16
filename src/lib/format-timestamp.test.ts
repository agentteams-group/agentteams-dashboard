// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { nanoToMs, formatNanoTimestamp } from './format-timestamp';

describe('nanoToMs', () => {
  it('parses a 19-digit nanosecond string exactly (BigInt path)', () => {
    // 1_755_000_000_123_456_789 ns → 1_755_000_000_123.456_789 ms (truncated)
    expect(nanoToMs('1755000000123456789')).toBe(1755000000123);
  });

  it('does not drift on values beyond Number.MAX_SAFE_INTEGER', () => {
    // 9_007_199_254_740_993 ns ≈ 9_007_199_254_740.993 ms: Number(input)
    // alone would round the 19-digit input; BigInt keeps it exact.
    const ms = nanoToMs('9007199254740993000');
    expect(ms).toBe(9007199254740);
  });

  it('accepts 13-digit millisecond strings (unit fallback)', () => {
    expect(nanoToMs('1755000000000')).toBe(1755000000000);
  });

  it('rejects 0, negatives, non-numeric and empty input', () => {
    expect(nanoToMs('0')).toBeNull();
    expect(nanoToMs('-123')).toBeNull();
    expect(nanoToMs('12a34')).toBeNull();
    expect(nanoToMs('')).toBeNull();
    expect(nanoToMs('1.5e12')).toBeNull();
  });
});

describe('formatNanoTimestamp', () => {
  it('formats a valid nanosecond timestamp to a locale string', () => {
    const out = formatNanoTimestamp('1755000000123456789');
    expect(out).not.toBe('1755000000123456789');
    expect(() => new Date(out).valueOf()).not.toThrow();
  });

  it('returns unparseable input verbatim (no fake unix-seconds slice)', () => {
    expect(formatNanoTimestamp('garbage')).toBe('garbage');
    expect(formatNanoTimestamp('')).toBe('');
    expect(formatNanoTimestamp('0')).toBe('0');
  });
});
