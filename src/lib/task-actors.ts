import type { ManagerResponse, TeamResponse, WorkerResponse } from '@/lib/agentteams-api';

/** All Matrix room ids a Manager can be the source of workflow messages for. */
export function managerRoomIds(manager: ManagerResponse): Set<string> {
  const ids = new Set<string>();
  if (manager.roomID) ids.add(manager.roomID);
  if (manager.leaderDMRoomID) ids.add(manager.leaderDMRoomID);
  return ids;
}

/** All Matrix room ids belonging to a Team. */
export function teamRoomIds(team: TeamResponse): Set<string> {
  const ids = new Set<string>();
  if (team.teamRoomID) ids.add(team.teamRoomID);
  if (team.leaderDMRoomID) ids.add(team.leaderDMRoomID);
  return ids;
}

/** Matrix room ids for an individual Worker (its own room and any Team rooms it belongs to). */
export function workerRoomIds(worker: WorkerResponse, team?: TeamResponse): Set<string> {
  const ids = new Set<string>();
  if (worker.roomID) ids.add(worker.roomID);
  if (team) {
    for (const rid of teamRoomIds(team)) ids.add(rid);
  }
  return ids;
}

export interface ActorLookup {
  /** All room ids the actor posts in (Manager) or is reachable in (Worker/Team). */
  roomIds: Set<string>;
  /** Matrix user id of the actor — only meaningful for Managers/Workers (not Teams). */
  matrixUserId: string;
}

export function actorFromManager(m: ManagerResponse): ActorLookup {
  return { roomIds: managerRoomIds(m), matrixUserId: m.matrixUserID || '' };
}

export function actorFromWorker(w: WorkerResponse, t?: TeamResponse): ActorLookup {
  return { roomIds: workerRoomIds(w, t), matrixUserId: w.matrixUserID || '' };
}

export function actorFromTeam(t: TeamResponse): ActorLookup {
  return { roomIds: teamRoomIds(t), matrixUserId: '' };
}

/**
 * Leader perspective: a Manager acting as leader of one or more Teams.
 *
 * The Leader's "task board" is the union of every team room they lead —
 * teamRoomID + leaderDMRoomID for each Team where this Manager is leader —
 * plus the Manager's own rooms (in case the Leader posts workflow from
 * their DM room).
 *
 * This matches how a real Leader would look at "tasks for my teams":
 * they see workflow messages that originated in any of their team rooms
 * (regardless of whether the sender is the Leader, a Worker, or another
 * agent acting inside the team).
 */
export function actorAsLeader(
  manager: ManagerResponse,
  teams: TeamResponse[] | undefined,
): ActorLookup {
  const ledTeams = (teams ?? []).filter((t) => t.leaderName === manager.name);
  const ids = new Set<string>(managerRoomIds(manager));
  for (const t of ledTeams) {
    for (const rid of teamRoomIds(t)) ids.add(rid);
  }
  return { roomIds: ids, matrixUserId: manager.matrixUserID || '' };
}

