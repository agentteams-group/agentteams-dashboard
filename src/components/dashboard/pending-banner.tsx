'use client';

import { useMemo } from 'react';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useHitlInboxStore } from '@/lib/hitl-inbox';
import { useInviteStore } from '@/lib/matrix-invite-store';
import { useRoomMetaStore } from '@/hooks/use-matrix';
import { useSectionStore } from '@/lib/section-store';

/**
 * 待办聚合横幅（PRD F4.3）：「N 条待你处理」按优先级聚合 ——
 * 待干预 > 待审批/邀请 > @我的；点击直达我的工作台；可关闭（本会话）。
 * 数据源 = 现有 Matrix /sync 驱动的 store（不承诺统一 SSE，§8.2 G5）。
 */
export function PendingBanner() {
  const confirmations = useHitlInboxStore((s) => s.confirmations);
  const inviteCount = useInviteStore((s) => Object.keys(s.invites).length);
  const roomMeta = useRoomMetaStore((s) => s.meta);
  const setActiveSection = useSectionStore((s) => s.setActiveSection);

  const { interventionCount, approvalCount, mentionRooms } = useMemo(() => {
    let intervention = 0;
    let approval = 0;
    for (const item of Object.values(confirmations)) {
      if (item.question) intervention += 1;
      else approval += 1;
    }
    const mention = Object.values(roomMeta).filter((m) => (m.unreadHighlightCount ?? 0) > 0).length;
    return { interventionCount: intervention, approvalCount: approval + inviteCount, mentionRooms: mention };
  }, [confirmations, inviteCount, roomMeta]);

  const total = interventionCount + approvalCount + mentionRooms;
  if (total === 0) return null;

  const parts: string[] = [];
  if (interventionCount > 0) parts.push(`${interventionCount} 条待干预`);
  if (approvalCount > 0) parts.push(`${approvalCount} 条待审批`);
  if (mentionRooms > 0) parts.push(`${mentionRooms} 个房间 @你`);

  return (
    <div
      role="status"
      className="flex items-center gap-2 px-4 py-1.5 text-xs bg-sky-500/10 border-b border-sky-500/20 text-sky-700 dark:text-sky-400"
    >
      <BellRing className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="flex-1 truncate">
        {total} 条待你处理（{parts.join(' · ')}）
      </span>
      <Button
        variant="ghost"
        size="sm"
        className="h-5 px-2 text-[10px] text-inherit hover:bg-sky-500/20"
        onClick={() => setActiveSection('my-workbench')}
      >
        去处理
      </Button>
    </div>
  );
}
