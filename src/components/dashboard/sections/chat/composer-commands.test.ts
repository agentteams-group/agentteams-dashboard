import { describe, it, expect } from 'vitest';
import { parseOutboundCommand, filterEmoji, EMOJI_ENTRIES } from './composer-commands';

describe('parseOutboundCommand', () => {
  it('returns null for plain text and unknown commands', () => {
    expect(parseOutboundCommand('hello world')).toBeNull();
    expect(parseOutboundCommand('/topic foo')).toBeNull();
    expect(parseOutboundCommand('/me')).toBeNull(); // empty action is not meaningful
    expect(parseOutboundCommand('')).toBeNull();
  });

  it('parses /me into an m.emote body without the prefix', () => {
    expect(parseOutboundCommand('/me 正在重启 worker')).toEqual({
      body: '正在重启 worker',
      msgtype: 'm.emote',
    });
    expect(parseOutboundCommand('  /me  deploys v2  ')).toEqual({
      body: 'deploys v2',
      msgtype: 'm.emote',
    });
  });

  it('parses /shrug with and without trailing text', () => {
    expect(parseOutboundCommand('/shrug')).toEqual({ body: '¯\\_(ツ)_/¯' });
    expect(parseOutboundCommand('/shrug 构建又挂了')).toEqual({
      body: '构建又挂了 ¯\\_(ツ)_/¯',
    });
  });
});

describe('filterEmoji', () => {
  it('returns the catalog head for an empty query', () => {
    const head = filterEmoji('');
    expect(head.length).toBeGreaterThan(0);
    expect(head.length).toBeLessThanOrEqual(8);
  });

  it('matches short code prefixes', () => {
    const results = filterEmoji('+1');
    expect(results[0].char).toBe('👍');
  });

  it('matches Chinese keywords', () => {
    const results = filterEmoji('庆祝');
    expect(results.some((e) => e.char === '🎉' || e.char === '🥳')).toBe(true);
  });

  it('matches English keywords', () => {
    const results = filterEmoji('rocket');
    expect(results[0].char).toBe('🚀');
  });

  it('returns empty for gibberish queries', () => {
    expect(filterEmoji('zzzzzz')).toEqual([]);
  });

  it('catalog has unique short codes and no empty keywords', () => {
    const names = EMOJI_ENTRIES.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
    for (const e of EMOJI_ENTRIES) {
      expect(e.char.length).toBeGreaterThan(0);
      expect(e.keywords.trim().length).toBeGreaterThan(0);
    }
  });
});
