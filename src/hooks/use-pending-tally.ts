'use client';

import { useMemo } from 'react';
import { selectPendingTally, useHitlInboxStore, type PendingTally } from '@/lib/hitl-inbox';
import { useInviteStore } from '@/lib/matrix-invite-store';
import { useRoomMetaStore } from '@/hooks/use-matrix';

/**
 * 「等我」计数（C-1 单一口径）：待干预 / 待审批 / Matrix 邀请 / @我的房间。
 *
 * 导航徽标、待办横幅、我的工作台三处以前各算各的（有的算邀请、有的算
 * 暂停项目），同一个「N 条待处理」在不同位置数字不一样。统一走这里。
 *
 * selector 只取原始 map（引用稳定），派生走 useMemo：直接把
 * selectPendingTally 当 selector 会每次返回新对象，触发
 * useSyncExternalStore 的 getSnapshot 缓存告警并无限重渲染。
 */
export function usePendingTally(): PendingTally {
  const confirmations = useHitlInboxStore((s) => s.confirmations);
  const invites = useInviteStore((s) => s.invites);
  const roomMeta = useRoomMetaStore((s) => s.meta);

  return useMemo(
    () => selectPendingTally(confirmations, invites, roomMeta),
    [confirmations, invites, roomMeta],
  );
}
