'use client';

import { useEffect, useSyncExternalStore } from 'react';

/**
 * 干预请求的等待窗口（F2.2 / 方案 v3 C-4）。
 *
 * 之所以不是 `useState`/`usePersistentState`：同一个阈值同时决定
 * `intervention-card` 的倒计时、HITL 收件箱的「超龄折叠」和我的工作台的
 * 分组。各组件各存一份的话，改一处其余要等重新挂载才跟得上，折叠边界就会
 * 和卡片上的倒计时互相矛盾。这里做成一个外部 store，全应用读同一个值。
 *
 * SSR 口径沿用仓库既有约定（`use-view-mode`）：服务端和首帧渲染默认值，
 * localStorage 里的偏好**挂载后**才应用，因此不会有 hydration 文本不一致。
 */

// 默认档沿用改造前 `intervention-card.tsx` 里写死的 30 分钟（方案 v3 C-4 只要求
// 「可配置」，不改动既有人的行为），所以老用户的观感与升级前完全一致。
export const DEFAULT_INTERVENTION_TIMEOUT_MS = 30 * 60 * 1000;

const STORAGE_KEY = 'agentteams:intervention-timeout-ms';

/** 可选项；不做自由输入，避免把待办折叠阈值配成一个没人看得懂的数。 */
export const INTERVENTION_TIMEOUT_PRESETS = [
  { label: '10 分钟', ms: 10 * 60 * 1000 },
  { label: '30 分钟', ms: 30 * 60 * 1000 },
  { label: '1 小时', ms: 60 * 60 * 1000 },
  { label: '4 小时', ms: 4 * 60 * 60 * 1000 },
] as const;

export const INTERVENTION_TIMEOUT_STORAGE_KEY = STORAGE_KEY;

const PRESET_MS: readonly number[] = INTERVENTION_TIMEOUT_PRESETS.map((p) => p.ms);

function isValidTimeout(raw: unknown): raw is number {
  return typeof raw === 'number' && Number.isFinite(raw) && PRESET_MS.includes(raw);
}

let current: number = DEFAULT_INTERVENTION_TIMEOUT_MS;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

/**
 * 读不出档位时一律按「保持默认值」处理：未设置、JSON 损坏、隐私模式读失败
 * 三种情况在这里不做区分 —— 这个偏好只有一种消费方式（选哪一档），没有可供
 * 调用方上报的失败语义；真要排查，看的是 localStorage 里的原始值而不是返回值。
 */
function readStored(): number | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (raw === null) return null;
    const parsed: unknown = JSON.parse(raw);
    return isValidTimeout(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

let loadedFromStorage = false;

/**
 * 把 localStorage 里的偏好读进 store（幂等，首次调用后才生效）。
 * 由 `useInterventionTimeoutMs()` 的挂载副作用调用，因此每个客户端会话只跑一次。
 */
function ensureLoaded(): void {
  if (loadedFromStorage) return;
  loadedFromStorage = true;
  const stored = readStored();
  if (stored !== null && stored !== current) {
    current = stored;
    emit();
  }
}

export function getInterventionTimeoutMs(): number {
  ensureLoaded();
  return current;
}

/** 设置超时并落盘；非法值忽略（只接受预置档位）。 */
export function setInterventionTimeoutMs(ms: number): void {
  ensureLoaded();
  if (!isValidTimeout(ms) || ms === current) return;
  current = ms;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(ms));
  } catch {
    // 持久化是尽力而为，本次会话内仍然生效
  }
  emit();
}

/** 当前阈值（毫秒）。SSR 与首帧返回默认值，挂载后切到已存偏好。 */
export function useInterventionTimeoutMs(): number {
  const value = useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    getInterventionTimeoutMs,
    () => DEFAULT_INTERVENTION_TIMEOUT_MS,
  );
  useEffect(() => {
    ensureLoaded();
  }, []);
  return value;
}

/** 超时通知文案里要读到的同一个数（人类可读）。 */
export function formatInterventionTimeout(ms: number): string {
  const match = INTERVENTION_TIMEOUT_PRESETS.find((p) => p.ms === ms);
  if (match) return match.label;
  return ms >= 60 * 60 * 1000 ? `${Math.round(ms / (60 * 60 * 1000))} 小时` : `${Math.round(ms / 60_000)} 分钟`;
}

/**
 * 一条待办是否已过龄：超过等待窗口仍未被答复。
 * 过龄不代表作废 —— C-4 的要求是不丢、不静默截断，只在 UI 上折叠。
 */
export function isAgedPending(
  timestamp: number,
  timeoutMs: number,
  now: number = Date.now(),
): boolean {
  return now - timestamp > timeoutMs;
}

/**
 * 按等待窗口把待办分成「还在窗口内」和「已过龄」两堆（C-4 的折叠口径）。
 * 入参需已排好序（两处列表都用 `selectConfirmationList`，新的在前），
 * 分堆后各自保持原顺序。过龄的只是收起来，不删、不丢。
 */
export function partitionByAge<T extends { timestamp: number }>(
  items: T[],
  timeoutMs: number,
  now: number = Date.now(),
): { fresh: T[]; aged: T[] } {
  const fresh: T[] = [];
  const aged: T[] = [];
  for (const item of items) {
    (isAgedPending(item.timestamp, timeoutMs, now) ? aged : fresh).push(item);
  }
  return { fresh, aged };
}
