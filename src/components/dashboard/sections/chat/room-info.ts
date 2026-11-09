import type { TeamResponse } from '@/lib/agentteams-api';

export interface RoomInfo {
  id: string;
  name: string;
  type: 'worker' | 'team' | 'manager' | 'human' | 'unknown';
  /** Product role of a direct assistant conversation. */
  agentRole?: 'operations' | 'leader';
  /** Room membership verified with the current user's own Matrix session. */
  access?: 'joined' | 'checking' | 'not-joined' | 'error' | 'disconnected';
  members: string[];
  parentTeam?: string;
  matrixUserId?: string;
  /** Worker MXIDs of this room (worker rooms: [the worker]; team rooms:
   *  the team's workers). Drives the session running dot (A17). */
  workerMatrixUserIds?: string[];
  phase?: string;
  /** Worker runtime (worker rooms only). */
  runtime?: string;
  /** AgentTeams worker resource name owning this room (worker rooms). */
  workerName?: string;
  /** Full AgentTeams team resource behind a team room (drives the header detail). */
  team?: TeamResponse;
  /** Latest message timestamp in this room (epoch ms). Drives sidebar sort. */
  lastMessageTs?: number;
  /** Latest message preview shown under the room name. */
  lastMessagePreview?: string;
  /** Unread message count (from /sync unread_notifications). */
  unreadCount?: number;
  /** Unread count of @mentions / highlighted messages. */
  unreadHighlightCount?: number;
  /** Joined member count (drives the 群组/私聊 kind filter; >2 = group). */
  memberCount?: number;
}
