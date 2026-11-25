'use client';

import { useEffect, useState } from 'react';
import { STATUS_TOKENS, type StatusToken } from '@/lib/status-tokens';

/**
 * 亮色主题下六个 token 的真色近似值，只在拿不到计算样式时用（SSR、jsdom）。
 * 与 globals.css `:root` 里的 oklch 同调，不是第二套调色盘：真色一律以解算结果为准。
 */
const LIGHT_FALLBACK: Record<StatusToken, string> = {
  running: '#0d8a80',
  waiting: '#a16207',
  blocked: '#c2410c',
  done: '#15803d',
  failed: '#b91c1c',
  info: '#1d4ed8',
};

/**
 * 把 var() 解成浏览器算完的真色。探针写法与 `knowledge-graph3d/palette.ts` 一致：
 * Recharts 的 `fill` 是 SVG 属性，而属性里不认 var()，只能在渲染前解算。
 */
function resolveCssColor(value: string): string {
  if (typeof window === 'undefined' || typeof document === 'undefined') return '';
  const probe = document.createElement('span');
  probe.style.color = value;
  probe.style.display = 'none';
  document.body.appendChild(probe);
  const resolved = window.getComputedStyle(probe).color;
  probe.remove();
  return resolved === '' || resolved.startsWith('var') ? '' : resolved;
}

function readStatusColors(): Record<StatusToken, string> {
  const out = { ...LIGHT_FALLBACK };
  for (const token of STATUS_TOKENS) {
    const resolved = resolveCssColor(`var(--status-${token})`);
    if (resolved) out[token] = resolved;
  }
  return out;
}

/**
 * 当前主题下六个语义状态 token 的真色，给图表 / canvas 这类不接受 var() 的地方用。
 * 首屏返回亮色兜底，挂载后按实际主题解算，并跟随根元素 class/style 变化（切主题即更新）。
 */
export function useStatusColors(): Record<StatusToken, string> {
  const [colors, setColors] = useState<Record<StatusToken, string>>(LIGHT_FALLBACK);
  useEffect(() => {
    const refresh = () => setColors(readStatusColors());
    refresh();
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'style'],
    });
    return () => observer.disconnect();
  }, []);
  return colors;
}
