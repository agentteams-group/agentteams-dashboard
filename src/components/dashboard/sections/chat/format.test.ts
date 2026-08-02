import { describe, it, expect } from 'vitest';
import {
  formatDate,
  formatTime,
  getAvatarColor,
  isDifferentDay,
  renderFormattedContent,
  resolveMentionsInHtml,
  resolveMentionsInText,
  resolveMentionsToDisplayNames,
} from '@/components/dashboard/sections/chat/format';

describe('getAvatarColor', () => {
  it('returns one of the palette classes', () => {
    const allowedPrefixes = [
      'bg-emerald-500/20',
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

describe('resolveMentionsToDisplayNames', () => {
  const memberMap = {
    '@worker:agentteams.io': 'worker',
    '@alice:agentteams.io': 'Alice',
  };

  it('resolves full user id to display name', () => {
    expect(resolveMentionsToDisplayNames('hi @worker:agentteams.io', memberMap)).toBe('hi worker');
  });

  it('resolves short name matching a display name', () => {
    expect(resolveMentionsToDisplayNames('hi @worker', memberMap)).toBe('hi worker');
  });

  it('keeps unmatched mentions unchanged', () => {
    expect(resolveMentionsToDisplayNames('hi @ghost @ghost:elsewhere.io', memberMap)).toBe(
      'hi @ghost @ghost:elsewhere.io'
    );
  });

  it('is case-insensitive when matching short names', () => {
    expect(resolveMentionsToDisplayNames('hi @ALICE', memberMap)).toBe('hi Alice');
  });

  it('returns text unchanged when memberMap is empty', () => {
    expect(resolveMentionsToDisplayNames('hi @worker:agentteams.io', {})).toBe(
      'hi @worker:agentteams.io'
    );
  });

  it('is idempotent once resolved to a display name', () => {
    const once = resolveMentionsToDisplayNames('hi @worker:agentteams.io', memberMap);
    expect(resolveMentionsToDisplayNames(once, memberMap)).toBe('hi worker');
  });
});

describe('resolveMentionsInHtml', () => {
  const memberMap = {
    '@worker:agentteams.io': 'worker',
    '@alice:agentteams.io': 'Alice',
  };

  it('resolves mentions in html text to escaped display name', () => {
    const out = resolveMentionsInHtml('<p>Hey @worker:agentteams.io!</p>', memberMap);
    expect(out).toBe('<p>Hey worker!</p>');
  });

  it('wraps resolved mentions with a render callback', () => {
    const out = resolveMentionsInHtml(
      '<p>@worker:agentteams.io</p>',
      memberMap,
      (name) => `<span class="matrix-mention">${name}</span>`
    );
    expect(out).toContain('<span class="matrix-mention">worker</span>');
  });

  it('does not replace mentions inside tag attributes', () => {
    const html =
      '<a href="https://x/@worker:agentteams.io" title="@worker">link @worker</a>';
    const out = resolveMentionsInHtml(html, memberMap);
    expect(out).toContain('href="https://x/@worker:agentteams.io"');
    expect(out).toContain('title="@worker"');
    expect(out).toContain('link worker');
  });

  it('keeps unmatched mentions unchanged in html', () => {
    expect(resolveMentionsInHtml('<p>@ghost</p>', memberMap)).toBe('<p>@ghost</p>');
  });

  it('returns html unchanged when memberMap is empty', () => {
    expect(resolveMentionsInHtml('<p>@worker:agentteams.io</p>', {})).toBe(
      '<p>@worker:agentteams.io</p>'
    );
  });
});

describe('resolveMentionsInText', () => {
  it('delegates to resolveMentionsToDisplayNames', () => {
    const memberMap = { '@worker:agentteams.io': 'worker' };
    expect(resolveMentionsInText('hi @worker:agentteams.io', memberMap)).toBe('hi worker');
    expect(resolveMentionsInText('hi @worker', memberMap)).toBe('hi worker');
  });
});
