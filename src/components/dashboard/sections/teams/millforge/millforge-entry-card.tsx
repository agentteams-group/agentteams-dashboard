'use client';

// 团队详情抽屉的「千锻」入口卡——整卡即按钮：图标 + 标题 + 一句说明
// （注入 / 自定义 / 模块更新 / 历史）+ 右侧 ›，点击打开四 tab 弹窗。

import { ChevronRight, Hammer } from 'lucide-react';

export function MillforgeEntryCard({ onClick }: { onClick: () => void }) {
  return (
    <section className="min-w-0 rounded-lg border">
      <button
        type="button"
        data-testid="millforge-card"
        aria-label="千锻"
        onClick={onClick}
        className="flex min-h-11 w-full cursor-pointer items-center gap-2.5 p-2.5 text-left hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
      >
        <Hammer className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="truncate text-xs font-semibold">千锻</span>
          <span className="truncate text-xs text-muted-foreground">
            注入 / 自定义 / 模块更新 / 历史
          </span>
        </span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
      </button>
    </section>
  );
}
