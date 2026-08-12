import { beforeEach, describe, expect, it } from 'vitest';
import { clearToolCallLedger, countToolCalls24h, recordToolCalls } from './tool-call-counter';

beforeEach(() => clearToolCallLedger());

describe('tool-call-counter', () => {
  it('counts tool calls per worker within 24h', () => {
    const now = Date.now();
    recordToolCalls('w1', '$e1', 2, now);
    recordToolCalls('w1', '$e2', 1, now);
    recordToolCalls('w2', '$e3', 5, now);
    expect(countToolCalls24h('w1', now)).toBe(3);
    expect(countToolCalls24h('w2', now)).toBe(5);
    expect(countToolCalls24h('w3', now)).toBe(0);
  });

  it('only counts the delta when the same event grows (streaming revisions)', () => {
    const now = Date.now();
    recordToolCalls('w1', '$e1', 1, now);
    recordToolCalls('w1', '$e1', 3, now);
    recordToolCalls('w1', '$e1', 3, now);
    expect(countToolCalls24h('w1', now)).toBe(3);
  });

  it('expires entries older than 24h', () => {
    const now = Date.now();
    recordToolCalls('w1', '$old', 2, now - 25 * 3_600_000);
    recordToolCalls('w1', '$fresh', 1, now - 1_000);
    expect(countToolCalls24h('w1', now)).toBe(1);
  });

  it('ignores invalid input and survives broken storage', () => {
    recordToolCalls('', '$e1', 1);
    recordToolCalls('w1', '', 1);
    recordToolCalls('w1', '$e1', 0);
    expect(countToolCalls24h('w1')).toBe(0);
    window.localStorage.setItem('agentteams:toolcall-ledger:v1', 'not json');
    expect(countToolCalls24h('w1')).toBe(0);
  });
});
