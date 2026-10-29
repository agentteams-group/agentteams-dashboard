'use client';

import { useEffect, useState } from 'react';
import type { Transition } from 'framer-motion';

/**
 * 动效预算规范（方案 v3 A-7）：
 * 1. 时长约束：微交互与结构过渡恒 ≤ 200ms；
 * 2. 属性约束：只允许操作 transform (位移/缩放) 与 opacity，禁止对 height/width/padding
 *    等触发布局重排（reflow）的几何属性做动画；
 * 3. 无障碍约束：全局尊重 prefers-reduced-motion 与用户显式关闭动效偏好。
 */
export const MOTION_BUDGET_MS = 200;
export const MOTION_BUDGET_SEC = 0.2;

export const MOTION_EASE_OUT = [0.16, 1, 0.3, 1] as const;

export const MOTION_PRESETS = {
  fade: {
    initial: { opacity: 0 },
    animate: { opacity: 1 },
    exit: { opacity: 0 },
    transition: { duration: MOTION_BUDGET_SEC, ease: 'easeOut' },
  },
  slideDown: {
    initial: { opacity: 0, y: -4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -4 },
    transition: { duration: MOTION_BUDGET_SEC, ease: 'easeOut' },
  },
  slideUp: {
    initial: { opacity: 0, y: 4 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: 4 },
    transition: { duration: MOTION_BUDGET_SEC, ease: 'easeOut' },
  },
  tapScale: {
    scale: 0.99,
  },
} as const;

const STORAGE_KEY = 'agentteams_reduced_motion';

/**
 * 全局动效状态与偏好监听 Hook。
 * 综合系统 media 查询与本地持久化开关，决定当前是否降级为静态/零动效模式。
 */
export function useAppReducedMotion(): {
  shouldReduceMotion: boolean;
  setOverride: (_reduced: boolean | null) => void;
  override: boolean | null;
} {
  const [systemReduced, setSystemReduced] = useState(false);
  const [override, setOverrideState] = useState<boolean | null>(() => {
    if (typeof window === 'undefined') return null;
    try {
      const val = localStorage.getItem(STORAGE_KEY);
      if (val === 'true') return true;
      if (val === 'false') return false;
    } catch {
      // localStorage disabled
    }
    return null;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    setSystemReduced(media.matches);

    const handler = (e: MediaQueryListEvent) => {
      setSystemReduced(e.matches);
    };

    media.addEventListener?.('change', handler);
    return () => media.removeEventListener?.('change', handler);
  }, []);

  const setOverride = (val: boolean | null) => {
    setOverrideState(val);
    try {
      if (val === null) {
        localStorage.removeItem(STORAGE_KEY);
      } else {
        localStorage.setItem(STORAGE_KEY, String(val));
      }
    } catch {
      // ignore storage failure
    }
  };

  const shouldReduceMotion = override !== null ? override : systemReduced;

  return { shouldReduceMotion, setOverride, override };
}

/**
 * 根据是否减弱动效安全裁剪 transition 对象：
 * 开启减弱动效时返回 { duration: 0 } 瞬间切换，避免视觉晃动。
 */
export function getSafeTransition(
  baseTransition?: Transition,
  shouldReduce?: boolean,
): Transition {
  if (shouldReduce) {
    return { duration: 0 };
  }
  return {
    duration: MOTION_BUDGET_SEC,
    ease: 'easeOut',
    ...baseTransition,
  };
}
