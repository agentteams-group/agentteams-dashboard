export interface RoomInfo {
  id: string;
  name: string;
  type: 'worker' | 'team' | 'manager' | 'human' | 'unknown';
  members: string[];
  parentTeam?: string;
  matrixUserId?: string;
  phase?: string;
  /** Latest message timestamp in this room (epoch ms). Drives sidebar sort. */
  lastMessageTs?: number;
  /** Unread message count (from /sync unread_notifications). */
  unreadCount?: number;
  /** Unread count of @mentions / highlighted messages. */
  unreadHighlightCount?: number;
}
