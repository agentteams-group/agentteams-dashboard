'use client';

import type { CSSProperties } from 'react';

/**
 * Small gradient "Beta" pill rendered next to experimental sidebar nav
 * labels (任务看板 / 项目). Kept separate from the settings-dialog so the
 * two surfaces can evolve independently.
 */
export function NavBetaBadge({ style }: { style?: CSSProperties }) {
  return (
    <span
      style={style}
      className="pointer-events-none inline-flex items-center rounded-full border border-violet-500/30 bg-gradient-to-r from-violet-500/15 via-fuchsia-500/15 to-amber-500/10 px-1 py-px text-[9px] font-semibold uppercase leading-3 tracking-wider text-violet-600 dark:text-violet-300"
      title="Beta 功能"
    >
      Beta
    </span>
  );
}

/**
 * Compact corner marker for the collapsed sidebar: a tiny gradient dot on
 * the icon's top-right corner instead of the full pill (no room for text
 * at w-16).
 */
export function NavBetaDot() {
  return (
    <span
      className="pointer-events-none absolute top-0.5 right-0.5 h-2 w-2 rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-500 ring-1 ring-background"
      title="Beta 功能"
    />
  );
}
