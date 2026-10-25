'use client';

import { useMemo } from 'react';
import {
  Inbox,
  MessageSquare,
  AtSign,
  ArrowRight,
  Sparkles,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SectionHeader } from '@/components/dashboard/section-header';
import { useHitlInboxStore, selectConfirmationList } from '@/lib/hitl-inbox';
import { useInviteStore } from '@/lib/matrix-invite-store';
import { openChatRoom } from '@/lib/open-chat-room';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { WelcomeSteps } from './welcome-steps';

function formatRelative(ts: number): string {
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleDateString('zh-CN');
}

/**
 * 我的工作台（PRD F4.2）：聚合「等我」事项 —— 待处理干预/审批（HITL
 * 收件箱）、@我的消息（房间 highlight）、暂停项目；每类条目可直达上下文。
 * 优先级：待干预 > 待放行/审批 > @我（F4.3 同一口径）。
 */
export function MyWorkbenchSection() {
  // selector 只取 map（引用稳定），排序派生走 useMemo —— 直接把
  // selectConfirmationList 当 selector 会每次返回新数组，触发
  // useSyncExternalStore 的 getSnapshot 缓存告警并无限重渲染。
  const confirmationsMap = useHitlInboxStore((s) => s.confirmations);
  const confirmations = useMemo(() => selectConfirmationList(confirmationsMap), [confirmationsMap]);
  const invites = useInviteStore((s) => s.invites);
  const roomMeta = useRoomMetaStore((s) => s.meta);
  const roomLabels = useRoomLabels();

  // @我的消息：房间 highlight（@提及未读）Top 列表。
  const mentionedRooms = useMemo(
    () =>
      Object.entries(roomMeta)
        .filter(([, m]) => (m.unreadHighlightCount ?? 0) > 0)
        .sort((a, b) => (b[1].unreadHighlightCount ?? 0) - (a[1].unreadHighlightCount ?? 0))
        .slice(0, 8),
    [roomMeta],
  );

  const interventions = confirmations.filter((c) => c.question);
  const approvals = confirmations.filter((c) => !c.question);
  const pendingCount = confirmations.length + Object.keys(invites).length;

  return (
    <div className="space-y-4">
      <SectionHeader
        title="我的工作台"
        description="一屏处理全部「等我」事项 —— 待干预 > 待审批 > @我的"
      />

      <WelcomeSteps
        visible={confirmations.length === 0 && mentionedRooms.length === 0 && Object.keys(invites).length === 0}
      />

      {/* 三栏看板：待干预 / 待审批+邀请 / @我，宽屏并排，窄屏回落单列 */}
      <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-3">
      {/* 待处理干预（优先级最高） */}
      <Card className="py-3 border-l-4 border-l-sky-500">
        <CardContent className="px-4 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Inbox className="h-3.5 w-3.5 text-sky-500" aria-hidden="true" />
            待处理干预（{interventions.length}）
          </p>
          {interventions.length === 0 && (
            <p className="text-[11px] text-muted-foreground">没有等待你答复的执行中提问。</p>
          )}
          {interventions.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openChatRoom(item.roomId)}
              className="w-full text-left rounded-lg border border-sky-500/20 bg-sky-500/5 hover:bg-sky-500/10 px-3 py-2 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{item.question}</span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {formatRelative(item.timestamp)}
                </span>
              </div>
              <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                <MessageSquare className="h-2.5 w-2.5" aria-hidden="true" />
                {roomLabels[item.roomId] ?? item.roomId}
              </span>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* 待审批 + 邀请 */}
      <Card className="py-3 border-l-4 border-l-amber-500">
        <CardContent className="px-4 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Inbox className="h-3.5 w-3.5 text-amber-500" aria-hidden="true" />
            待审批（{approvals.length}）· 邀请（{Object.keys(invites).length}）
          </p>
          {approvals.length === 0 && Object.keys(invites).length === 0 && (
            <p className="text-[11px] text-muted-foreground">没有待你审批的工具请求或房间邀请。</p>
          )}
          {approvals.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openChatRoom(item.roomId)}
              className="w-full text-left rounded-lg border border-amber-500/20 bg-amber-500/5 hover:bg-amber-500/10 px-3 py-2 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">工具审批 · {item.toolName}</span>
                <span className="text-[10px] text-muted-foreground whitespace-nowrap">
                  {formatRelative(item.timestamp)}
                </span>
              </div>
              <span className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground">
                <MessageSquare className="h-2.5 w-2.5" aria-hidden="true" />
                {roomLabels[item.roomId] ?? item.roomId}
              </span>
            </button>
          ))}
          {Object.entries(invites).map(([roomId, invite]) => (
            <button
              key={roomId}
              type="button"
              onClick={() => openChatRoom(roomId)}
              className="w-full text-left rounded-lg border border-border/60 hover:bg-accent/50 px-3 py-2 transition-colors"
            >
              <span className="text-sm font-medium">房间邀请 · {roomLabels[roomId] ?? invite.roomId ?? roomId}</span>
            </button>
          ))}
        </CardContent>
      </Card>

      {/* @我的消息 */}
      <Card className="py-3">
        <CardContent className="px-4 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <AtSign className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            @我的消息（{mentionedRooms.length} 个房间）
          </p>
          {mentionedRooms.length === 0 && (
            <p className="text-[11px] text-muted-foreground">没有未读的 @提及。</p>
          )}
          {mentionedRooms.map(([roomId, meta]) => (
            <button
              key={roomId}
              type="button"
              onClick={() => openChatRoom(roomId)}
              className="w-full text-left rounded-lg border border-border/60 hover:bg-accent/50 px-3 py-2 transition-colors flex items-center gap-2"
            >
              <MessageSquare className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
              <span className="text-sm truncate flex-1">{roomLabels[roomId] ?? meta.roomName ?? roomId}</span>
              <Badge variant="outline" className="text-[10px] shrink-0">
                {meta.unreadHighlightCount} 条 @提醒
              </Badge>
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
            </button>
          ))}
        </CardContent>
      </Card>
      </div>

      {pendingCount === 0 && mentionedRooms.length === 0 && (
        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <Sparkles className="h-3.5 w-3.5" aria-hidden="true" />
          全部处理完毕。
        </p>
      )}
    </div>
  );
}

function useRoomLabels(): Record<string, string> {
  const roomMeta = useRoomMetaStore((s) => s.meta);
  return useMemo(() => {
    const labels: Record<string, string> = {};
    for (const [id, meta] of Object.entries(roomMeta)) {
      if (meta.roomName) labels[id] = meta.roomName;
    }
    return labels;
  }, [roomMeta]);
}
