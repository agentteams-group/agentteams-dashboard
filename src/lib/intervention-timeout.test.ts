import { describe, expect, it } from 'vitest';
import {
  DEFAULT_INTERVENTION_TIMEOUT_MS,
  INTERVENTION_TIMEOUT_PRESETS,
  INTERVENTION_TIMEOUT_STORAGE_KEY,
  getInterventionTimeoutMs,
  isAgedPending,
  partitionByAge,
  setInterventionTimeoutMs,
} from '@/lib/intervention-timeout';

/**
 * 干预等待窗口（方案 v3 C-4）：它同时是干预卡倒计时的阈值和两处待办列表
 * 的折叠阈值，所以档位只能取预置值，并且要真的落盘。
 */
describe('干预等待窗口偏好', () => {
  it('默认档位沿用改造前写死的 30 分钟，且预置表里就有它', () => {
    expect(DEFAULT_INTERVENTION_TIMEOUT_MS).toBe(30 * 60 * 1000);
    expect(INTERVENTION_TIMEOUT_PRESETS.map((p) => p.ms)).toContain(DEFAULT_INTERVENTION_TIMEOUT_MS);
  });

  it('切到预置档位后生效并写入 localStorage', () => {
    const tenMinutes = 10 * 60 * 1000;
    setInterventionTimeoutMs(tenMinutes);
    expect(getInterventionTimeoutMs()).toBe(tenMinutes);
    expect(window.localStorage.getItem(INTERVENTION_TIMEOUT_STORAGE_KEY)).toBe(
      JSON.stringify(tenMinutes),
    );
  });

  it('非预置档位被忽略，不会把折叠阈值配成没人看得懂的数', () => {
    const before = getInterventionTimeoutMs();
    setInterventionTimeoutMs(7 * 60 * 1000);
    setInterventionTimeoutMs(Number.NaN);
    expect(getInterventionTimeoutMs()).toBe(before);
  });

  it('isAgedPending 以窗口为界（刚好到点不算超龄）', () => {
    const now = 10 * 60 * 1000;
    expect(isAgedPending(now - 10 * 60 * 1000, 10 * 60 * 1000, now)).toBe(false);
    expect(isAgedPending(now - 10 * 60 * 1000 - 1, 10 * 60 * 1000, now)).toBe(true);
  });

  it('partitionByAge 分堆后各自保持原有顺序（新的在前）', () => {
    const now = Date.now();
    const items = [
      { id: 'a', timestamp: now - 1000 },
      { id: 'b', timestamp: now - 8 * 60 * 1000 },
      { id: 'c', timestamp: now - 20 * 60 * 1000 },
      { id: 'd', timestamp: now - 45 * 60 * 1000 },
    ];
    const { fresh, aged } = partitionByAge(items, 30 * 60 * 1000, now);
    expect(fresh.map((i) => i.id)).toEqual(['a', 'b', 'c']);
    expect(aged.map((i) => i.id)).toEqual(['d']);
    // 过龄的只是收起来：一条都没丢
    expect(fresh.length + aged.length).toBe(items.length);
  });
});
