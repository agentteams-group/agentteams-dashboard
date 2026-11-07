import type { RoomInfo } from './room-info';

/** Only use conversations returned by the current user's resource queries. */
export function preferredAgentRoom(rooms: RoomInfo[], userLevel: number): RoomInfo | undefined {
  if (userLevel >= 3) {
    const operations = rooms.find((room) => room.agentRole === 'operations');
    if (operations) return operations;
  }
  return rooms.find((room) => room.agentRole === 'leader');
}
