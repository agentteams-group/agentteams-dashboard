'use client';

import type { LucideIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

/**
 * section 级空态（方案 v3 A-4「四态规范」里漏掉的最后一态）。
 *
 * 为什么要有这个组件：在这之前每个 section 自己写一行「暂无…」——图标尺寸有 w-7 /
 * w-8 / w-10 / w-12 四种、留白有 py-4 / py-6 / p-8 / p-12 四种，更要命的是没有主行动：
 * 用户被留在一张空白卡片上，知道「没有 Worker」却不知道下一步该点哪儿（创建入口其实
 * 就在同一个页面顶部，但空态里不提，新手就原地卡住）。加载骨架（section-skeleton）、
 * 错误态（api-error-state）、离线（connection-banner）都早有统一件，唯独空态没收敛。
 *
 * 配色走本仓的单轨 token：文字只写语义名（`text-muted-foreground` /
 * `text-card-foreground`），图标底用状态色 `status-info` 的 15% 淡染——值在
 * globals.css 的 :root / .dark / .high-contrast 各定义一次，组件里不出现任何具体色值，
 * 三套主题自动同步（对比度由 src/lib/theme/contrast.test.ts 守着）。
 */

interface SectionEmptyStateProps {
  /** 装饰性图标，已 aria-hidden；不传就不渲染图标层（小面板里更紧凑）。 */
  icon?: LucideIcon;
  title: string;
  description?: string;
  /**
   * 主行动。**只有这里确实能立刻做一件事才传**（新建项目、登记 MCP、上传技能）：
   * 纯列表为空、或者下一步在别的页面时别硬造一个按钮，那样只会稀释它的作用。
   */
  action?: { label: string; onClick: () => void };
  className?: string;
}

export function SectionEmptyState({
  icon: Icon,
  title,
  description,
  action,
  className,
}: SectionEmptyStateProps) {
  return (
    <div
      // role="status"（polite live region）：筛选把列表清空、或第一条数据进来时，
      // 读屏会播报这次变化；没有它，用户只能盯着空白区猜「是没加载，还是真没有」。
      role="status"
      className={cn('flex flex-col items-center justify-center px-4 py-10 text-center', className)}
    >
      {Icon ? (
        <span
          className="mb-3 flex size-11 shrink-0 items-center justify-center rounded-full bg-status-info/15"
          aria-hidden="true"
        >
          <Icon className="h-5 w-5 text-status-info" />
        </span>
      ) : null}

      <p className="text-sm font-medium text-card-foreground">{title}</p>

      {description ? (
        <p className="mt-1 max-w-md text-xs leading-relaxed text-muted-foreground">{description}</p>
      ) : null}

      {action ? (
        <Button size="sm" className="mt-4" onClick={action.onClick}>
          {action.label}
        </Button>
      ) : null}
    </div>
  );
}
