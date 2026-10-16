import { describe, expect, it } from 'vitest';
import {
  CODING_RUN_STATUS_META,
  formatBytes,
  formatCodingRunInstant,
  parseCodingRunTime,
} from './coding-runs';

describe('parseCodingRunTime', () => {
  it('解析 run-YYYYMMDD-HHMMSS.log', () => {
    expect(parseCodingRunTime('run-20261015-131415.log')).toBe('2026-10-15 13:14:15');
  });

  it('无法解析时原样返回', () => {
    expect(parseCodingRunTime('weird-name')).toBe('weird-name');
  });
});

describe('formatCodingRunInstant', () => {
  it('非法值原样返回', () => {
    expect(formatCodingRunInstant('not-a-date')).toBe('not-a-date');
  });

  it('合法 ISO 转为本地可读串（形如 YYYY-MM-DD HH:mm:ss）', () => {
    expect(formatCodingRunInstant('2026-10-15T05:14:15Z')).toMatch(
      /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/,
    );
  });
});

describe('formatBytes', () => {
  it('按量级格式化', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });
});

describe('CODING_RUN_STATUS_META', () => {
  it('覆盖上游四种状态', () => {
    expect(Object.keys(CODING_RUN_STATUS_META).sort()).toEqual([
      'blocked',
      'failed',
      'ok',
      'timeout',
    ]);
  });
});
