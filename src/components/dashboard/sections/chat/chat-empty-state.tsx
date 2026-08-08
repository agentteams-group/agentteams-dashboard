'use client';

import { ArrowRight, LogIn, MessageSquare } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ChatEmptyState({
  isLoggedIn,
  onLoginClick,
}: {
  isLoggedIn: boolean;
  onLoginClick: () => void;
}) {
  return (
    <div className="flex items-center justify-center h-full text-center p-8">
      <div className="max-w-md">
        <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-primary/15 to-primary/5 flex items-center justify-center mx-auto mb-5">
          <MessageSquare className="w-7 h-7 text-primary" aria-hidden="true" />
        </div>
        <p className="text-[11px] uppercase tracking-[0.2em] text-primary/80 mb-2">Agent Workspace</p>
        <h3 className="font-semibold text-xl mb-2">选择一个会话开始协作</h3>
        <p className="text-sm text-muted-foreground">
          从左侧房间列表中选择一个 Matrix 房间，即可查看消息记录和发送消息。
          {isLoggedIn ? '' : ' 请先登录 Matrix 账号以发送消息。'}
        </p>
        {!isLoggedIn && (
          <Button variant="outline" className="mt-4" onClick={onLoginClick}>
            <LogIn className="w-4 h-4 mr-2" aria-hidden="true" />
            登录 Matrix
          </Button>
        )}
        {isLoggedIn && (
          <div className="mt-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            选择左侧会话 <ArrowRight className="w-3.5 h-3.5" />
          </div>
        )}
      </div>
    </div>
  );
}
