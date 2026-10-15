import { describe, expect, it } from 'vitest';
import { parseCodingRunTime } from './coding-runs';

describe('parseCodingRunTime', () => {
  it('解析 run-YYYYMMDD-HHMMSS.log', () => {
    expect(parseCodingRunTime('run-20261015-131415.log')).toBe('2026-10-15 13:14:15');
  });

  it('无法解析时原样返回', () => {
    expect(parseCodingRunTime('weird-name')).toBe('weird-name');
  });
});
