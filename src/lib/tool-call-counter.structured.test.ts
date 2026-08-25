import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearToolCallLedger,
  countToolCalls24h,
  recordToolCalls,
} from './tool-call-counter';

beforeEach(() => clearToolCallLedger());

describe('tool-call-counter structured keys', () => {
  it('counts each unique structured id once even if the event revision repeats', () => {
    const now = Date.now();
    recordToolCalls('w1', '$e1', 2, now, ['call-a', 'call-b']);
    recordToolCalls('w1', '$e1', 2, now + 1, ['call-a', 'call-b']);
    expect(countToolCalls24h('w1', now + 1)).toBe(2);
  });

  it('adds only the unseen ids when a revision carries a partial overlap', () => {
    const now = Date.now();
    recordToolCalls('w1', '$e1', 0, now, ['call-a']);
    recordToolCalls('w1', '$e1', 0, now + 1, ['call-a', 'call-b']);
    expect(countToolCalls24h('w1', now + 1)).toBe(2);
  });

  it('uses structured ids as the authoritative dedupe (event-delta is bypassed)', () => {
    const now = Date.now();
    recordToolCalls('w1', '$e1', 1, now, ['call-a']);
    recordToolCalls('w1', '$e1', 2, now + 1, ['call-a', 'call-b']);
    expect(countToolCalls24h('w1', now + 1)).toBe(2);
  });

  it('ignores empty or non-string structured keys', () => {
    const now = Date.now();
    recordToolCalls('w1', '$e1', 0, now, ['', undefined as unknown as string, '  ']);
    expect(countToolCalls24h('w1', now)).toBe(0);
  });

  it('still records timestamps when only structured keys are provided', () => {
    const now = Date.now();
    recordToolCalls('w1', '', 0, now, ['call-a']);
    expect(countToolCalls24h('w1', now)).toBe(1);
  });

  it('persists structured keys across ledger reloads', () => {
    const now = Date.now();
    recordToolCalls('w1', '$e1', 0, now, ['call-a', 'call-b']);
    // Re-reading the ledger should keep the dedupe memory.
    recordToolCalls('w1', '$e1', 0, now + 1, ['call-a', 'call-b', 'call-c']);
    expect(countToolCalls24h('w1', now + 1)).toBe(3);
  });

  it('keeps per-worker isolation of structured key memory', () => {
    const now = Date.now();
    recordToolCalls('w1', '$e1', 0, now, ['call-a']);
    recordToolCalls('w2', '$e1', 0, now, ['call-a']);
    expect(countToolCalls24h('w1', now)).toBe(1);
    expect(countToolCalls24h('w2', now)).toBe(1);
  });
});