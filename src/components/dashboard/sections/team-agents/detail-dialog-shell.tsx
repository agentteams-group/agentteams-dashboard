'use client';

import * as React from 'react';
import { X } from 'lucide-react';
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

/**
 * 团队/Agent 工作台详情大弹窗壳（R2）。
 *
 * 尺寸策略（经 cn = twMerge 覆盖 DialogContent 默认类）：
 * - 桌面（≥640px）：w-[min(1200px,94vw)]，max-h-[88vh]
 * - 窄屏（<640px）：w-[96vw]，max-h-[94vh]（近全屏）
 * - 内容区独立滚动（min-h-0 flex-1）；头部 shrink-0 常驻；
 *   右上角关闭按钮（DialogClose，size-11 ≥44px 触控目标）。
 *
 * bodyClassName：
 * - 面板自带滚动链（TeamSettingsPanel 内部 min-h-0 flex-1 overflow-y-auto）：
 *   传 "flex flex-col overflow-hidden"，让面板以 flex-1 撑满并内部自滚；
 * - 面板需要容器滚动（Worker/ManagerDetailPanel，Worker 自带 sticky 头）：
 *   传 "overflow-y-auto"（缺省）。
 */
export function DetailDialogShell({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  bodyClassName,
  contentClassName,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  /** 底部操作条（sticky）；面板自带操作区时不传。 */
  footer?: React.ReactNode;
  bodyClassName?: string;
  contentClassName?: string;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-label={title}
        showCloseButton={false}
        className={cn(
          // 覆盖默认弹窗：grid→flex 纵向布局、两套尺寸、整体不滚（内容区独立滚）。
          'flex max-h-[94vh] w-[96vw] max-w-none flex-col gap-0 overflow-hidden p-0 sm:max-h-[88vh] sm:w-[min(1200px,94vw)] sm:max-w-[min(1200px,94vw)]',
          contentClassName,
        )}
      >
        <header className="flex min-h-11 shrink-0 items-center gap-2 border-b bg-background px-4">
          <DialogTitle className="min-w-0 flex-1 truncate text-base leading-none">{title}</DialogTitle>
          <DialogDescription className="sr-only">{description ?? title}</DialogDescription>
          <DialogClose
            aria-label="关闭"
            className="flex size-11 shrink-0 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <X className="size-5" aria-hidden="true" />
          </DialogClose>
        </header>
        <div className={cn('min-h-0 flex-1', bodyClassName ?? 'overflow-y-auto')}>{children}</div>
        {footer ? (
          <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t bg-background px-4 py-2.5">
            {footer}
          </footer>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
