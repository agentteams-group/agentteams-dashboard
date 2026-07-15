import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatTime,
  getAvatarColor,
  isDifferentDay,
  renderFormattedContent,
} from '@/components/dashboard/sections/chat/format';

describe('getAvatarColor', () => {
  it('returns one of the palette classes', () => {
    const allowedPrefixes = [
      'bg-primary/20',
      'bg-cyan-500/20',
      'bg-violet-500/20',
      'bg-emerald-500/20',
      'bg-rose-500/20',
      'bg-amber-500/20',
      'bg-blue-500/20',
      'bg-pink-500/20',
    ];
    for (const input of ['alice', 'bob', '', 'x']) {
      const color = getAvatarColor(input);
      expect(allowedPrefixes.some((p) => color.startsWith(p))).toBe(true);
    }
  });

  it('is deterministic for the same input', () => {
    expect(getAvatarColor('xyz')).toBe(getAvatarColor('xyz'));
  });

  it('distinguishes different inputs', () => {
    const colors = new Set<string>();
    for (let i = 0; i < 20; i++) {
      colors.add(getAvatarColor(`user-${i}`));
    }
    expect(colors.size).toBeGreaterThan(1);
  });
});

describe('formatTime', () => {
  it('returns HH:MM', () => {
    const ts = new Date(2025, 0, 1, 14, 30).getTime();
    expect(formatTime(ts)).toMatch(/^\d{2}:\d{2}$/);
  });
});

describe('formatDate', () => {
  it('returns 今天 for today', () => {
    const today = new Date();
    today.setHours(12, 0, 0, 0);
    expect(formatDate(today.getTime())).toBe('今天');
  });

  it('returns 昨天 for yesterday', () => {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(12, 0, 0, 0);
    expect(formatDate(yesterday.getTime())).toBe('昨天');
  });

  it('returns formatted date for older days', () => {
    const old = new Date(2020, 5, 15, 12, 0, 0, 0).getTime();
    const out = formatDate(old);
    expect(out).not.toBe('今天');
    expect(out).not.toBe('昨天');
  });
});

describe('isDifferentDay', () => {
  it('returns false for two times on the same day', () => {
    const a = new Date(2025, 0, 1, 10, 0).getTime();
    const b = new Date(2025, 0, 1, 23, 59).getTime();
    expect(isDifferentDay(a, b)).toBe(false);
  });

  it('returns true across day boundary', () => {
    const a = new Date(2025, 0, 1, 23, 59).getTime();
    const b = new Date(2025, 0, 2, 0, 0).getTime();
    expect(isDifferentDay(a, b)).toBe(true);
  });
});

describe('renderFormattedContent', () => {
  it('uses fallback when formatted is empty', () => {
    const out = renderFormattedContent('', 'plain text');
    expect(out.html).toContain('plain text');
  });

  it('preserves safe html', () => {
    const out = renderFormattedContent('<b>bold</b>', 'x');
    expect(out.html).toContain('<b>bold</b>');
  });

  it('strips script tags', () => {
    const out = renderFormattedContent('<script>alert(1)</script>safe', 'x');
    expect(out.html.toLowerCase()).not.toContain('script');
    expect(out.html).toContain('safe');
  });
});
