import type { ManagerResponse, TeamResponse, WorkerResponse } from '@/lib/hiclaw-api';
import type { RoomInfo } from './room-info';

export function buildRooms(
  workers: WorkerResponse[] | undefined,
  teams: TeamResponse[] | undefined,
  managers: ManagerResponse[] | undefined,
): RoomInfo[] {
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
      r.members.some((m) => m.toLowerCase().includes(q)),
  );
}
