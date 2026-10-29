'use client';

import { LogIn, LogOut, Unlock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { MatrixLoginForm } from './matrix-login-form';

export function ChatAuthBadge({
  isLoggedIn,
  userId,
  onLogout,
  onLoginClick,
  showLoginDialog,
  onLoginDialogChange,
  compact = false,
}: {
  isLoggedIn: boolean;
  userId: string | null;
  onLogout: () => void;
  onLoginClick: () => void;
  showLoginDialog: boolean;
  onLoginDialogChange: (_open: boolean) => void;
  /** One-line variant for the room sidebar footer. */
  compact?: boolean;
}) {
  if (isLoggedIn && compact) {
    const shortId = userId?.split(':')[0].slice(1);
    return (
      <div className="flex min-w-0 items-center gap-1.5">
        <Badge
          variant="outline"
          className="shrink-0 gap-1 border-emerald-500/30 text-xs text-emerald-600 dark:text-emerald-400"
        >
          <Unlock className="w-3 h-3" aria-hidden="true" />
          Matrix 已连接
        </Badge>
        <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted-foreground" title={userId ?? ''}>
          {shortId}
        </span>
        <Button
          variant="ghost"
          size="sm"
          className="h-6 w-6 shrink-0 p-0 text-muted-foreground"
          onClick={onLogout}
          title="登出 Matrix"
          aria-label="登出 Matrix"
        >
          <LogOut className="w-3.5 h-3.5" aria-hidden="true" />
        </Button>
      </div>
    );
  }
  if (isLoggedIn) {
    const shortId = userId?.split(':')[0].slice(1);
    return (
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="text-xs gap-1 border-emerald-500/30 text-emerald-600 dark:text-emerald-400"
        >
          <Unlock className="w-3 h-3" aria-hidden="true" />
          Matrix 已连接
        </Badge>
        <Badge variant="outline" className="text-xs font-mono max-w-[120px] truncate">
          {shortId}
        </Badge>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 text-xs text-muted-foreground"
          onClick={onLogout}
        >
          <LogOut className="w-3 h-3 mr-1" aria-hidden="true" />
          登出
        </Button>
      </div>
    );
  }
  return (
    <Dialog open={showLoginDialog} onOpenChange={onLoginDialogChange}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm" className="h-7 text-xs gap-1" onClick={onLoginClick}>
          <LogIn className="w-3 h-3" aria-hidden="true" />
          登录 Matrix
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>登录 Matrix 服务器</DialogTitle>
        </DialogHeader>
        <MatrixLoginForm onLoginSuccess={() => onLoginDialogChange(false)} />
      </DialogContent>
    </Dialog>
  );
}
