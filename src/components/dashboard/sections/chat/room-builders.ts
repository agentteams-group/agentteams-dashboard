import type { ManagerResponse, TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import type { RoomInfo } from './room-info';

export interface RoomMetaInput {
  lastMessageTs?: number;
  unreadCount?: number;
  unreadHighlightCount?: number;
}

/** Lookup table for per-room meta. Keys are Matrix room ids. */
export type RoomMetaByRoomId = Record<string, RoomMetaInput>;

/**
 * Build the sidebar room list from agent/team/manager resources.
 *
 * Each room's lastMessageTs / unreadCount is filled in from the supplied
 * `metaByRoomId` (driven by /sync). Rooms with newer activity float to the
 * top of the sidebar naturally because ChatSection sorts after this returns.
 */
export function buildRooms(
  workers: WorkerResponse[] | undefined,
  teams: TeamResponse[] | undefined,
  managers: ManagerResponse[] | undefined,
  metaByRoomId?: RoomMetaByRoomId,
): RoomInfo[] {
  const lookup = metaByRoomId ?? {};
  const enrich = (rid: string): Pick<RoomInfo, 'lastMessageTs' | 'unreadCount' | 'unreadHighlightCount'> => {
    const m = lookup[rid];
    if (!m) return {};
    return {
      lastMessageTs: m.lastMessageTs,
      unreadCount: m.unreadCount,
      unreadHighlightCount: m.unreadHighlightCount,
    };
  };

  const roomList: RoomInfo[] = [];
  teams?.forEach((team) => {
    if (team.teamRoomID) {
      roomList.push({
        id: team.teamRoomID,
        name: `${team.name} 团队房间`,
        type: 'team',
        members: team.workerNames || [],
        parentTeam: team.name,
        phase: team.phase,
        ...enrich(team.teamRoomID),
      });
    }
  });
  workers?.forEach((worker) => {
    if (worker.roomID) {
      roomList.push({
        id: worker.roomID,
        name: `${worker.name} 房间`,
        type: 'worker',
        members: [worker.matrixUserID].filter(Boolean),
        parentTeam: worker.team,
        matrixUserId: worker.matrixUserID,
        phase: worker.phase,
        ...enrich(worker.roomID),
      });
    }
  });
  managers?.forEach((manager) => {
    // Prefer the DM room for human-manager interaction; fall back to manager's own room
    const chatRoomId = manager.leaderDMRoomID || manager.roomID;
    if (chatRoomId) {
      // Find the team this manager leads
      const leadingTeam = teams?.find((t) => t.leaderName === manager.name);
      roomList.push({
        id: chatRoomId,
        name: `${manager.name} 对话`,
        type: 'manager',
        members: [manager.matrixUserID].filter(Boolean),
        matrixUserId: manager.matrixUserID,
        parentTeam: leadingTeam?.name,
        phase: manager.phase,
        ...enrich(chatRoomId),
      });
    }
  });
  return roomList;
}

export function filterRooms(rooms: RoomInfo[], filter: string): RoomInfo[] {
  if (!filter) return rooms;
  const q = filter.toLowerCase();
  return rooms.filter(
    (r) =>
      r.name.toLowerCase().includes(q) ||
      r.id.toLowerCase().includes(q) ||
      r.members.some((m) => m && m.toLowerCase().includes(q)),
  );
}

/**
 * Sort rooms by latest activity (newest message first), then alphabetically.
 * Rooms without a last-message timestamp fall to the tail. Unread state and
 * @mention highlights do NOT influence the order — they are rendered as badges
 * so clearing an unread room never makes it jump in the list.
 */
export function sortRoomsByRecency(rooms: RoomInfo[]): RoomInfo[] {
  return [...rooms].sort((a, b) => {
    const ta = a.lastMessageTs;
    const tb = b.lastMessageTs;
    if (ta !== undefined && tb !== undefined) {
      if (ta !== tb) return tb - ta;
    } else if (ta !== undefined) {
      return -1; // a has a timestamp, b doesn't → a first
    } else if (tb !== undefined) {
      return 1; // b has a timestamp, a doesn't → b first
    }
    return a.name.localeCompare(b.name);
  });
}
