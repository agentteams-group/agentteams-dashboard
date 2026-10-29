'use client';

import { useMemo, useState } from 'react';
import {
  Inbox,
  MessageSquare,
  AtSign,
  ArrowRight,
  Sparkles,
  ChevronDown,
  ChevronRight,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { SectionHeader } from '@/components/dashboard/section-header';
import { useHitlInboxStore, selectConfirmationList } from '@/lib/hitl-inbox';
import { useInviteStore } from '@/lib/matrix-invite-store';
import { openChatRoom } from '@/lib/open-chat-room';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { usePendingTally } from '@/hooks/use-pending-tally';
import { formatInterventionTimeout, partitionByAge, useInterventionTimeoutMs } from '@/lib/intervention-timeout';
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
  // C-4：超过等待窗口的条目默认收起来（不删不丢），卡片标题里的计数仍用全量，
  // 所以用户不会以为旧的待办自动消失了。
  const timeoutMs = useInterventionTimeoutMs();
  const [showAgedInterventions, setShowAgedInterventions] = useState(false);
  const [showAgedApprovals, setShowAgedApprovals] = useState(false);
  const interventionAged = useMemo(() => partitionByAge(interventions, timeoutMs), [interventions, timeoutMs]);
  const approvalAged = useMemo(() => partitionByAge(approvals, timeoutMs), [approvals, timeoutMs]);
  const shownInterventions = showAgedInterventions ? interventions : interventionAged.fresh;
  const shownApprovals = showAgedApprovals ? approvals : approvalAged.fresh;
  // 「等我」总数走统一口径（C-1）：比本页分项多出 @我 一项，与导航徽标、
  // 待办横幅取同一个 selector，不再各算一套。
  const pendingCount = usePendingTally().total;

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
      <Card className="py-3 border-l-4 border-l-status-waiting">
        <CardContent className="px-4 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Inbox className="h-3.5 w-3.5 text-status-waiting" aria-hidden="true" />
            待处理干预（{interventions.length}）
          </p>
          {interventions.length === 0 && (
            <p className="text-xs text-muted-foreground">没有等待你答复的执行中提问。</p>
          )}
          {shownInterventions.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openChatRoom(item.roomId)}
              className="w-full text-left rounded-lg border border-status-waiting/20 bg-status-waiting/5 hover:bg-status-waiting/10 px-3 py-2 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">{item.question}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatRelative(item.timestamp)}
                </span>
              </div>
              <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MessageSquare className="h-2.5 w-2.5" aria-hidden="true" />
                {roomLabels[item.roomId] ?? item.roomId}
              </span>
            </button>
          ))}
          {interventionAged.aged.length > 0 && (
            <AgedToggle
              count={interventionAged.aged.length}
              timeoutLabel={formatInterventionTimeout(timeoutMs)}
              expanded={showAgedInterventions}
              onToggle={() => setShowAgedInterventions((v) => !v)}
            />
          )}
        </CardContent>
      </Card>

      {/* 待审批 + 邀请 */}
      <Card className="py-3 border-l-4 border-l-status-blocked">
        <CardContent className="px-4 space-y-2">
          <p className="text-xs font-semibold flex items-center gap-1.5">
            <Inbox className="h-3.5 w-3.5 text-status-blocked" aria-hidden="true" />
            待审批（{approvals.length}）· 邀请（{Object.keys(invites).length}）
          </p>
          {approvals.length === 0 && Object.keys(invites).length === 0 && (
            <p className="text-xs text-muted-foreground">没有待你审批的工具请求或房间邀请。</p>
          )}
          {shownApprovals.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => openChatRoom(item.roomId)}
              className="w-full text-left rounded-lg border border-status-blocked/20 bg-status-blocked/5 hover:bg-status-blocked/10 px-3 py-2 transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-medium truncate">工具审批 · {item.toolName}</span>
                <span className="text-xs text-muted-foreground whitespace-nowrap">
                  {formatRelative(item.timestamp)}
                </span>
              </div>
              <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                <MessageSquare className="h-2.5 w-2.5" aria-hidden="true" />
                {roomLabels[item.roomId] ?? item.roomId}
              </span>
            </button>
          ))}
          {approvalAged.aged.length > 0 && (
            <AgedToggle
              count={approvalAged.aged.length}
              timeoutLabel={formatInterventionTimeout(timeoutMs)}
              expanded={showAgedApprovals}
              onToggle={() => setShowAgedApprovals((v) => !v)}
            />
          )}
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
            <p className="text-xs text-muted-foreground">没有未读的 @提及。</p>
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
              <Badge variant="outline" className="text-xs shrink-0">
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

/**
 * 「另有 N 条更早待处理」的展开开关。待办不再被上限截断后，长期挂着
 * 没人答的条目会一直堆在这里；收起来只为了不让它淹没新一项，展开后仍然
 * 可以点进房间处理。
 */
function AgedToggle({
  count,
  timeoutLabel,
  expanded,
  onToggle,
}: {
  count: number;
  timeoutLabel: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={expanded}
      className="flex w-full items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent/60 hover:text-foreground"
    >
      {expanded ? (
        <ChevronDown className="h-3 w-3 shrink-0" aria-hidden="true" />
      ) : (
        <ChevronRight className="h-3 w-3 shrink-0" aria-hidden="true" />
      )}
      另有 {count} 条更早待处理（超过 {timeoutLabel}）
    </button>
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
