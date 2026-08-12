import { describe, expect, it } from 'vitest';
import {
  buildStatusNarrative,
  failureSummary,
  formatAgoZh,
  formatDurationZh,
  healthTierLabel,
  truncateCell,
} from './worker-activity';
import type { WorkerResponse } from '@/lib/agentteams-api';

const NOW = 1_800_000_000_000;

function worker(overrides: Partial<WorkerResponse>): WorkerResponse {
  return {
    name: 'w',
    phase: 'Running',
    state: 'Running',
    containerManaged: true,
    model: 'm',
    runtime: 'openclaw',
    image: 'i',
    containerState: 'running',
    matrixUserID: '@w:s',
    roomID: '!r:s',
    message: '',
    team: '',
    role: '',
    ...overrides,
  };
}

describe('formatDurationZh', () => {
  it('formats minutes / hours / days', () => {
    expect(formatDurationZh(new Date(NOW - 30_000).toISOString(), NOW)).toBe('不到 1 分钟');
    expect(formatDurationZh(new Date(NOW - 12 * 60_000).toISOString(), NOW)).toBe('12 分钟');
    expect(formatDurationZh(new Date(NOW - 3 * 3_600_000).toISOString(), NOW)).toBe('3 小时');
    expect(formatDurationZh(new Date(NOW - 2 * 86_400_000).toISOString(), NOW)).toBe('2 天');
  });

  it('returns null for invalid timestamps', () => {
    expect(formatDurationZh('not-a-date', NOW)).toBeNull();
  });
});

describe('formatAgoZh', () => {
  it('formats relative past times', () => {
    expect(formatAgoZh(new Date(NOW - 10_000).toISOString(), NOW)).toBe('刚刚');
    expect(formatAgoZh(new Date(NOW - 5 * 60_000).toISOString(), NOW)).toBe('5 分钟前');
    expect(formatAgoZh(new Date(NOW - 26 * 3_600_000).toISOString(), NOW)).toBe('1 天前');
  });
});

describe('truncateCell', () => {
  it('keeps short text and ellipsizes long text', () => {
    expect(truncateCell('短文本')).toBe('短文本');
    expect(truncateCell('这是一段非常非常长的任务摘要文本', 12)).toBe('这是一段非常非常长的任…');
  });
});

describe('healthTierLabel', () => {
  it('maps scores to the three tiers for active phases', () => {
    expect(healthTierLabel(90, 'Running')).toBe('稳定运行');
    expect(healthTierLabel(60, 'Running')).toBe('偶有异常');
    expect(healthTierLabel(10, 'Running')).toBe('频繁出错');
  });

  it('uses neutral phase wording for inactive phases', () => {
    expect(healthTierLabel(70, 'Sleeping')).toBe('休眠中');
    expect(healthTierLabel(20, 'Stopped')).toBe('已停机');
    expect(healthTierLabel(40, 'Pending')).toBe('就绪中');
    expect(healthTierLabel(90, 'Failed')).toBe('频繁出错');
  });
});

describe('failureSummary', () => {
  it('takes the first non-empty line and strips stacks', () => {
    expect(failureSummary('tool_guard 拒绝\nError: boom\n  at x.js:1')).toBe('tool_guard 拒绝');
    expect(failureSummary('')).toBeNull();
    expect(failureSummary(undefined)).toBeNull();
  });
});

describe('buildStatusNarrative', () => {
  it('Running with team and task', () => {
    expect(
      buildStatusNarrative(worker({ team: 'alpha', lastTaskSummary: '工单 #1' }), NOW),
    ).toBe('正在帮 alpha 处理 工单 #1');
  });

  it('Running without team', () => {
    expect(buildStatusNarrative(worker({ message: '巡检' }), NOW)).toBe('正在处理 巡检');
  });

  it('Running without any task info', () => {
    expect(buildStatusNarrative(worker({}), NOW)).toBe('运行中，暂无任务摘要');
  });

  it('Sleeping with and without stateStartedAt', () => {
    const started = new Date(NOW - 12 * 60_000).toISOString();
    expect(buildStatusNarrative(worker({ phase: 'Sleeping', stateStartedAt: started }), NOW)).toBe('空闲 12 分钟');
    expect(buildStatusNarrative(worker({ phase: 'Sleeping' }), NOW)).toBe('休眠中');
  });

  it('covers the remaining phases', () => {
    expect(buildStatusNarrative(worker({ phase: 'Ready' }), NOW)).toBe('已就绪，等待任务');
    expect(buildStatusNarrative(worker({ phase: 'Pending' }), NOW)).toBe('等待 Controller 派发镜像，预计 < 2 分钟');
    expect(buildStatusNarrative(worker({ phase: 'Stopped' }), NOW)).toBe('已停机');
    expect(buildStatusNarrative(worker({ phase: 'Updating' }), NOW)).toBe('正在拉取新镜像');
    expect(buildStatusNarrative(worker({ phase: 'Failed', message: 'OOM Killed' }), NOW)).toBe('最近失败：OOM Killed');
    expect(buildStatusNarrative(worker({ phase: 'Failed' }), NOW)).toBe('失败，暂无错误摘要');
  });
});
