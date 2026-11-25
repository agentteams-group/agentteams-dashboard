import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-error';
import {
  MANAGER_LOG_TAIL,
  MANAGER_LOG_TAIL_MAX,
  clampLogTail,
  classifyManagerLogError,
  formatManagerLogLines,
  managerContainerName,
  parseManagerLogText,
} from './manager-logs';

describe('managerContainerName', () => {
  it('uses the shared manager container name for the default Manager', () => {
    expect(managerContainerName('default')).toBe('agentteams-manager');
  });

  it('prefixes the CR name for every other Manager', () => {
    expect(managerContainerName('alpha')).toBe('agentteams-manager-alpha');
    expect(managerContainerName('  staging  ')).toBe('agentteams-manager-staging');
  });
});

describe('clampLogTail', () => {
  it('defaults to 300 for missing / invalid / non-positive input', () => {
    expect(clampLogTail(null)).toBe(MANAGER_LOG_TAIL);
    expect(clampLogTail(undefined)).toBe(MANAGER_LOG_TAIL);
    expect(clampLogTail('abc')).toBe(MANAGER_LOG_TAIL);
    expect(clampLogTail('0')).toBe(MANAGER_LOG_TAIL);
    expect(clampLogTail('-5')).toBe(MANAGER_LOG_TAIL);
  });

  it('accepts a valid tail and caps it', () => {
    expect(clampLogTail('300')).toBe(300);
    expect(clampLogTail(42)).toBe(42);
    expect(clampLogTail('999999')).toBe(MANAGER_LOG_TAIL_MAX);
  });
});

describe('formatManagerLogLines', () => {
  it('renders `timestamp message` and marks error lines', () => {
    expect(
      formatManagerLogLines([
        { timestamp: '2026-11-08T10:00:00Z', level: 'info', message: 'started' },
        { timestamp: '2026-11-08T10:00:01Z', level: 'error', message: 'boom' },
      ]),
    ).toEqual(['2026-11-08T10:00:00Z started', '2026-11-08T10:00:01Z ❌ boom']);
  });

  it('drops empty rows instead of inventing content', () => {
    expect(formatManagerLogLines([{ message: '' }, {}])).toEqual([]);
    expect(formatManagerLogLines(undefined)).toEqual([]);
  });
});

describe('parseManagerLogText', () => {
  it('splits docker log text into timestamped lines', () => {
    const lines = parseManagerLogText(
      '2026-11-08T10:00:00.123456789Z hello\n\nplain line\n',
      'default',
    );
    expect(lines).toEqual([
      { timestamp: '2026-11-08T10:00:00.123456789Z', level: 'info', component: 'default', message: 'hello' },
      { timestamp: '', level: 'info', component: 'default', message: 'plain line' },
    ]);
  });
});

describe('classifyManagerLogError', () => {
  it('maps 404/405 to missing, 403 to forbidden and everything else to error', () => {
    expect(classifyManagerLogError(new ApiError('nope', 404, '/logs'))).toBe('missing');
    expect(classifyManagerLogError(new ApiError('nope', 405, '/logs'))).toBe('missing');
    expect(classifyManagerLogError(new ApiError('denied', 403, '/logs'))).toBe('forbidden');
    expect(classifyManagerLogError(new ApiError('boom', 502, '/logs'))).toBe('error');
    expect(classifyManagerLogError(new Error('network'))).toBe('error');
  });
});
