'use client';

import { ArrowRight, LogIn, MessageSquare, Bot } from 'lucide-react';
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
        {/* Illustration */}
        <div className="relative w-24 h-24 mx-auto mb-6">
          <div className="absolute inset-0 bg-gradient-to-br from-emerald-500/20 to-primary/20 rounded-3xl rotate-6" />
          <div className="absolute inset-0 bg-gradient-to-br from-primary/15 to-emerald-500/15 rounded-2xl flex items-center justify-center">
            <Bot className="w-10 h-10 text-primary" />
          </div>
          <div className="absolute -bottom-1 -right-1 w-8 h-8 bg-emerald-500 rounded-full flex items-center justify-center">
            <MessageSquare className="w-4 h-4 text-emerald-50" />
          </div>
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
