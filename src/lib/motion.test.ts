import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  MOTION_BUDGET_MS,
  MOTION_BUDGET_SEC,
  getSafeTransition,
  useAppReducedMotion,
} from './motion';

describe('motion 预算与全局开关 (A-7)', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('时长预算严格约束在 200ms 内', () => {
    expect(MOTION_BUDGET_MS).toBeLessThanOrEqual(200);
    expect(MOTION_BUDGET_SEC).toBeLessThanOrEqual(0.2);
  });

  it('getSafeTransition 在减弱动效时将过渡时间置零', () => {
    const normal = getSafeTransition({ duration: 0.15 });
    expect(normal.duration).toBe(0.15);

    const reduced = getSafeTransition({ duration: 0.15 }, true);
    expect(reduced.duration).toBe(0);
  });

  it('useAppReducedMotion 支持手动覆盖并持久化至 localStorage', () => {
    const { result } = renderHook(() => useAppReducedMotion());

    act(() => {
      result.current.setOverride(true);
    });

    expect(result.current.shouldReduceMotion).toBe(true);
    expect(result.current.override).toBe(true);
    expect(localStorage.getItem('agentteams_reduced_motion')).toBe('true');

    act(() => {
      result.current.setOverride(false);
    });
    expect(result.current.shouldReduceMotion).toBe(false);
    expect(result.current.override).toBe(false);

    act(() => {
      result.current.setOverride(null);
    });
    expect(result.current.override).toBeNull();
    expect(localStorage.getItem('agentteams_reduced_motion')).toBeNull();
  });
});
