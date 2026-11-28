'use client';

import { ArrowRight, LogIn, Bot } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useSectionStore } from '@/lib/section-store';

export function ChatEmptyState({
  isLoggedIn,
  onLoginClick,
  view = 'all',
}: {
  isLoggedIn: boolean;
  onLoginClick: () => void;
  view?: 'all' | 'assistants' | 'teams';
}) {
  return (
    <div className="flex items-center justify-center h-full text-center p-8">
      <div className="max-w-md">
        {/* Illustration */}
        <div className="mx-auto mb-5 flex size-14 items-center justify-center rounded-xl border bg-muted/30">
          <Bot className="size-6 text-muted-foreground" />
        </div>
        <h3 className="font-semibold text-xl mb-2">{view === 'teams' ? '暂无已加入的团队' : view === 'assistants' ? '暂无可用的私聊助手' : '和你的 Agent，一起推进工作'}</h3>
        <p className="text-sm text-muted-foreground">
          {view === 'assistants' ? 'AgentTeams助手和团队助手均为私聊。团队助手仅对 Team Admin 开放，普通成员可到「我的团队」参与群聊。' : view === 'teams' ? '加入团队后，可以在这里查看团队成员的交流与协作记录。' : '选择上方的助手或团队房间，开始对话或查看协作记录。'}
          {isLoggedIn ? '' : ' 连接账号后即可继续对话。'}
        </p>
        {!isLoggedIn && (
          <Button variant="outline" className="mt-4" onClick={onLoginClick}>
            <LogIn className="w-4 h-4 mr-2" aria-hidden="true" />
            连接对话
          </Button>
        )}
        {isLoggedIn && view === 'assistants' && <Button variant="outline" className="mt-4" onClick={() => useSectionStore.getState().setActiveSection('my-teams')}>查看我的团队</Button>}
        {isLoggedIn && view !== 'assistants' && (
          <div className="mt-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            通过上方入口切换房间 <ArrowRight className="w-3.5 h-3.5" />
          </div>
        )}
      </div>
    </div>
  );
}
