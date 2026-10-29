'use client';

import { Inbox, MessageSquare, Search } from 'lucide-react';
import { useSectionStore } from '@/lib/section-store';
import { usePendingTally } from '@/hooks/use-pending-tally';
import { hashForSection } from '@/lib/nav-hash';
import { cn } from '@/lib/utils';

/**
 * 移动端底部常驻栏（方案 v3 C-6「移动端主路径」）。
 *
 * 窄屏只给三个入口 —— 等我 / 空间 / 搜索，抽屉导航（mobile-sidebar）
 * 仍是完整导航，两者互不替代。计数一律走 `usePendingTally()`：与待办横幅、
 * 我的工作台、抽屉徽标同一个口径（C-1），这里不再另算一套。
 *
 * 导航只写 `window.location.hash`（单一导航路径约定）：`use-active-section`
 * 的 hashchange 监听器统一解析分层 hash 并落到 store，组件自己不调 setter。
 */

interface MobileQuickBarProps {
  /**
   * 打开全局搜索（命令面板）。装配点复用已有机制：聚焦顶栏搜索框 ——
   * `header.tsx` 的 onFocus 会把面板打开，与 ⌘/Ctrl+K 是同一条路径，
   * 所以不需要为它新增 store。
   */
  onSearch: () => void;
}

/** 徽标文案：0 不显示（由调用方判断），>99 收成 99+。 */
function badgeText(count: number): string {
  return count > 99 ? '99+' : String(count);
}

interface BarButtonProps {
  label: string;
  Icon: typeof Inbox;
  active: boolean;
  /** 待处理条数；0 或 undefined 时不渲染徽标。 */
  count?: number;
  onClick: () => void;
}

/**
 * 单个栏内按钮。点击区整格高（min-h-14 = 56px，≥44px 触控标准），
 * 图标 + 文案竖排；选中态用 primary，未选中用 muted-foreground，
 * 全部走主题变量 —— light / dark / high-contrast 三套主题自动跟随。
 */
function BarButton({ label, Icon, active, count, onClick }: BarButtonProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'relative flex min-h-14 w-full flex-col items-center justify-center gap-0.5',
        'px-1 py-2 text-xs transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset',
        active ? 'text-primary font-medium' : 'text-muted-foreground hover:text-foreground'
      )}
    >
      {/* 选中态顶部指示条：aria-current 已表达状态，这里只是视觉冗余提示。 */}
      {active && (
        <span
          aria-hidden="true"
          className="absolute inset-x-5 top-0 h-0.5 rounded-full bg-primary"
        />
      )}
      <Icon className="h-5 w-5" aria-hidden="true" />
      <span className="leading-tight">{label}</span>
      {typeof count === 'number' && count > 0 && (
        <span
          className={cn(
            'absolute right-1/2 top-1 translate-x-[calc(100%+0.6rem)]',
            'min-w-[18px] rounded-full px-1 py-px text-center text-xs font-semibold',
            'bg-status-waiting/15 text-status-waiting'
          )}
        >
          {badgeText(count)}
        </span>
      )}
    </button>
  );
}

export function MobileQuickBar({ onSearch }: MobileQuickBarProps) {
  const activeSection = useSectionStore((s) => s.activeSection);
  const pendingCount = usePendingTally().total;

  /** 切分区：只写 hash，剩下交给 use-active-section 的 hashchange 解析。 */
  const goTo = (sectionId: string) => {
    window.location.hash = `#${hashForSection(sectionId)}`;
  };

  return (
    <nav
      aria-label="快捷导航"
      /*
        z-30 而不是 z-50：抽屉导航（mobile-sidebar）的遮罩是 z-40、面板是 z-50，
        抽屉打开时底部栏要一起被压暗并让点击落到遮罩上，不能浮在遮罩之上。
      */
      className="fixed inset-x-0 bottom-0 z-30 md:hidden border-t border-border bg-card/95 backdrop-blur-sm pb-[env(safe-area-inset-bottom)]"
    >
      <ul className="flex items-stretch">
        <li className="flex-1">
          <BarButton
            label="等我"
            Icon={Inbox}
            active={activeSection === 'my-workbench'}
            count={pendingCount}
            onClick={() => goTo('my-workbench')}
          />
        </li>
        <li className="flex-1">
          <BarButton
            label="空间"
            Icon={MessageSquare}
            active={activeSection === 'chat'}
            onClick={() => goTo('chat')}
          />
        </li>
        <li className="flex-1">
          <BarButton label="搜索" Icon={Search} active={false} onClick={onSearch} />
        </li>
      </ul>
    </nav>
  );
}
