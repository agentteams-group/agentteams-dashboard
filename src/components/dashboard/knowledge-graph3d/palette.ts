import * as React from 'react';

// ── 主题适配（dashboard 无 antd/无插件 useThemeColors）──────────────────
export interface G3DPalette {
  surface: string;
  label: string;
  labelBackground: string;
  labelBorder: string;
  root: string;
  active: string;
  muted: string;
  isDark: boolean;
}

const SSR_FALLBACK: G3DPalette = {
  surface: '#ffffff',
  label: '#292522',
  labelBackground: '#fffdfb',
  labelBorder: '#ffc58f',
  root: '#ff7f16',
  active: '#d9650b',
  muted: '#c7bfb8',
  isDark: false,
};

/** 任意 CSS 颜色值（oklch/var 展开后）→ 浏览器序列化的 rgb(a) 串
 * （THREE.Color 对 oklch 直解不稳，统一经 DOM 序列化兜底）。 */
function resolveCssColor(value: string): string {
  if (!value) return '';
  const probe = document.createElement('span');
  probe.style.color = value;
  document.body.appendChild(probe);
  const resolved = window.getComputedStyle(probe).color;
  probe.remove();
  return resolved;
}

/** 读当前主题：.dark 类 + 计算后 CSS 变量（跟随 ThemeProvider 任意
 * 内置/自定义/企业主题——变量由 apply.ts 写到根元素内联样式）。 */
function readPalette(): G3DPalette {
  const root = document.documentElement;
  const cs = window.getComputedStyle(root);
  const isDark = root.classList.contains('dark');
  return {
    surface:
      resolveCssColor(cs.getPropertyValue('--background').trim()) ||
      (isDark ? '#141414' : '#ffffff'),
    label:
      resolveCssColor(cs.getPropertyValue('--foreground').trim()) ||
      (isDark ? 'rgba(255,255,255,0.88)' : '#292522'),
    // QwenPaw 官方回退值（暖灰，任意主题不违和——原值照抄）。
    labelBackground: isDark ? '#2a2622' : '#fffdfb',
    labelBorder: isDark ? 'rgba(255,127,22,0.55)' : '#ffc58f',
    root: '#ff7f16',
    active: isDark ? '#ff8a33' : '#d9650b',
    muted: isDark ? '#57534e' : '#c7bfb8',
    isDark,
  };
}

export function useGraph3DPalette(): G3DPalette {
  const [palette, setPalette] = React.useState<G3DPalette>(SSR_FALLBACK);
  React.useEffect(() => {
    const refresh = () => setPalette(readPalette());
    const root = document.documentElement;
    const mo = new MutationObserver(refresh);
    mo.observe(root, { attributes: true, attributeFilter: ['class', 'style'] });
    // jsdom 无 matchMedia（测试环境守卫；真浏览器恒有）
    const mq = typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-color-scheme: dark)')
      : null;
    mq?.addEventListener?.('change', refresh);
    refresh();
    return () => {
      mo.disconnect();
      mq?.removeEventListener?.('change', refresh);
    };
  }, []);
  return palette;
}
