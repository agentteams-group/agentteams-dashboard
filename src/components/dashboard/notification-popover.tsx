'use client';

import { Bell, Bot, Check, Trash2, CheckCircle2, XCircle, AlertTriangle, Info, ArrowRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription, SheetTrigger,
} from '@/components/ui/sheet';
import { useSectionStore } from '@/lib/section-store';
import { usePendingTally } from '@/hooks/use-pending-tally';
import { MyWorkbenchSection } from './sections/my-workbench-section';
import { useNotificationStore } from '@/lib/notification-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { hasNotificationTarget, openNotificationTarget } from '@/lib/notification-nav';
import { formatDistanceToNow } from 'date-fns';
import { zhCN } from 'date-fns/locale';

const typeIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  success: CheckCircle2,
  error: XCircle,
  warning: AlertTriangle,
  info: Info,
};

const typeColors: Record<string, string> = {
  success: 'text-emerald-500',
  error: 'text-red-500',
  warning: 'text-amber-500',
  info: 'text-cyan-500',
};

export function NotificationPopover() {
  const { notifications: allNotifications, markAsRead, markAllRead, clearAll } =
    useNotificationStore();
  const userId = useMatrixStore(state => state.userId);
  const notifications = allNotifications.filter(n => !n.recipientId || n.recipientId === userId);
  const count = notifications.filter(n => !n.read).length;
  // 跳完要把气泡关掉，所以 open 由本组件持有（原来是非受控，关不掉）。
  const open = useSectionStore(state => state.notificationsOpen);
  const setOpen = useSectionStore(state => state.setNotificationsOpen);
  const pending = usePendingTally().total;

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="h-9 w-9 relative" aria-label={`通知（${count} 条未读）${pending ? `，${pending} 条待处理` : ''}`}>
          <Bell className="w-4 h-4" aria-hidden="true" />
          {(count > 0 || pending > 0) && (
            <span className="absolute -right-1 -top-1 rounded-full bg-primary px-1 text-xs text-primary-foreground" aria-hidden="true">{pending > 0 ? pending > 99 ? '99+' : pending : '•'}</span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full sm:max-w-xl gap-0">
        <SheetHeader className="border-b">
          <SheetTitle>通知{pending > 0 && <span className="ml-2 text-sm font-normal text-muted-foreground">{pending} 条待处理</span>}</SheetTitle>
          <SheetDescription className="sr-only">处理审批、答复和 @提醒，查看系统通知。</SheetDescription>
        </SheetHeader>
        <div className="min-h-0 flex-1 overflow-y-auto custom-scrollbar">
        <div className="p-4"><MyWorkbenchSection onNavigate={() => setOpen(false)} /></div>
        <div className="flex items-center justify-between p-3 border-b">
          <span className="text-sm">系统与助手通知{count > 0 && <span className="ml-2 text-xs text-muted-foreground">{count} 条未读</span>}</span>
          <div className="flex gap-1">
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => markAllRead(userId)}>
              <Check className="w-3 h-3 mr-1" />
              全部已读
            </Button>
            <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => clearAll(userId)}>
              <Trash2 className="w-3 h-3 mr-1" />
              清空
            </Button>
          </div>
        </div>
        {/* Native overflow scroll: Radix ScrollArea's focusable viewport
            paints a ring that gets clipped into stray edge stripes. */}
        <div>
          {notifications.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground">
              暂无通知
            </div>
          ) : (
            <div className="divide-y">
              {notifications.map((n) => {
                const TypeIcon = n.kind === 'assistant' ? Bot : typeIcons[n.type] || Info;
                const typeColor = typeColors[n.type] || 'text-muted-foreground';
                const hasTarget = hasNotificationTarget(n);
                return (
                  <button
                    key={n.id}
                    type="button"
                    className={`block w-full p-3 text-left text-sm transition-colors hover:bg-accent focus-visible:bg-accent ${
                      !n.read ? 'border-l-2 border-l-primary bg-primary/[0.04]' : ''
                    }`}
                    onClick={() => {
                      markAsRead(n.id);
                      if (openNotificationTarget(n)) setOpen(false);
                    }}
                  >
                    <div className="flex items-start gap-2">
                      <TypeIcon className={`w-4 h-4 ${typeColor} mt-0.5 shrink-0`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={`font-medium ${!n.read ? 'text-foreground' : 'text-muted-foreground'}`}>
                            {n.title}
                          </p>
                          <Badge
                            variant={
                              n.type === 'success' ? 'default' :
                              n.type === 'error' ? 'destructive' :
                              n.type === 'warning' ? 'secondary' :
                              'outline'
                            }
                            className="text-xs shrink-0"
                          >
                            {n.kind === 'assistant' ? '助手提醒' : n.type === 'success' ? '成功' :
                             n.type === 'error' ? '错误' :
                             n.type === 'warning' ? '警告' : '信息'}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground truncate mt-0.5">
                          {n.message}
                        </p>
                      </div>
                    </div>
                    <div className="mt-1 ml-6 flex items-center justify-between gap-2">
                      <p className="text-xs text-muted-foreground">
                        {formatDistanceToNow(n.timestamp, { addSuffix: true, locale: zhCN })}
                      </p>
                      {hasTarget && (
                        <span className="inline-flex items-center gap-0.5 text-xs text-primary">
                          {n.kind === 'assistant' ? '查看助手会话' : '查看上下文'}
                          <ArrowRight className="h-3 w-3" aria-hidden="true" />
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
