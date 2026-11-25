import { roomHash } from '@/lib/nav-hash';
import type { Notification } from '@/lib/notification-store';

/**
 * 通知点击的唯一跳转入口：把通知指向的上下文写进 URL。
 *
 * 房间类通知（干预/审批超时）优先用 `roomId` 拼分层深链，其余走生产者写入的
 * `actionUrl`。这里不做任何 hash 解析——`use-active-section` 的 hashchange
 * 监听器已经负责 resolveHash + 深链落库（pendingChatRoomId）+ section 切换，
 * 再写一套只会让两条导航路径各自漂移。
 *
 * 返回 false 表示这条通知没有可跳转的上下文（调用方只标记已读）；目标 hash
 * 与当前一致时浏览器不会派发 hashchange，此时视为「已经在上下文里」，返回 true。
 */
export function openNotificationTarget(notification: Notification): boolean {
  const target = notification.roomId
    ? roomHash(notification.roomId)
    : notification.actionUrl?.startsWith('#')
      ? notification.actionUrl
      : null;
  if (!target) return false;
  if (window.location.hash !== target) {
    window.location.hash = target;
  }
  return true;
}

/** 这条通知能不能点进上下文（决定气泡里要不要给跳转提示）。 */
export function hasNotificationTarget(notification: Notification): boolean {
  return Boolean(notification.roomId || notification.actionUrl?.startsWith('#'));
}
