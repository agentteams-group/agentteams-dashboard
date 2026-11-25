import type { RoomInfo } from './room-info';

/** Resource visibility alone does not grant access to a Matrix conversation. */
export function canOpenConversation(room: RoomInfo): boolean {
  return room.access === 'joined';
}

export const LEADER_ACCESS_LABELS = {
  checking: '正在核验私聊权限',
  'not-joined': '尚未加入私聊，请联系团队管理员',
  error: '私聊权限暂时无法核验',
  disconnected: '连接对话后核验私聊权限',
};

export function withLeaderAccess(rooms: RoomInfo[], joinedRooms: string[] | undefined, state: NonNullable<RoomInfo['access']>): RoomInfo[] {
  const joined = new Set(joinedRooms);
  return rooms.map(room => ({
    ...room,
    access: state === 'joined' ? joined.has(room.id) ? 'joined' : 'not-joined' : state,
  }));
}

export function conversationStorageKey(homeserver: string, userId: string): string | null {
  return userId ? `chat-selection:v1:${encodeURIComponent(homeserver)}:${encodeURIComponent(userId)}` : null;
}

export function preferredAgentRoom(rooms: RoomInfo[], userLevel: number, rememberedId?: string | null): RoomInfo | undefined {
  const accessible = rooms.filter(room => canOpenConversation(room) && (userLevel >= 3 || room.agentRole !== 'operations'));
  const remembered = accessible.find(room => room.id === rememberedId);
  if (remembered) return remembered;
  if (userLevel >= 3) {
    const operations = accessible.find((room) => room.agentRole === 'operations');
    if (operations) return operations;
  }
  return accessible.filter(room => room.agentRole === 'leader').sort((a, b) => (a.parentTeam ?? a.name).localeCompare(b.parentTeam ?? b.name))[0];
}

export function conversationSections(rooms: RoomInfo[]) {
  const operations = rooms.filter(room => room.agentRole === 'operations');
  const projects: RoomInfo[] = [];
  const teams = new Map<string, { id: string; name: string; rooms: RoomInfo[] }>();
  const other: RoomInfo[] = [];
  for (const room of rooms) {
    if (room.agentRole === 'operations') continue;
    if (room.type === 'project') {
      projects.push(room);
    } else if (room.parentTeam && (room.agentRole === 'leader' || room.type === 'team')) {
      if (!teams.has(room.parentTeam)) teams.set(room.parentTeam, { id: room.parentTeam, name: room.team?.teamName || room.team?.name || room.parentTeam, rooms: [] });
      teams.get(room.parentTeam)!.rooms.push(room);
    } else other.push(room);
  }
  return {
    operations,
    teams: [...teams.values()].sort((a, b) => a.name.localeCompare(b.name)).map(team => ({ ...team, rooms: team.rooms.sort((a, b) => Number(b.agentRole === 'leader') - Number(a.agentRole === 'leader')) })),
    projects,
    other,
  };
}
