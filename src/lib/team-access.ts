import type { TeamResponse } from './agentteams-api';

/** Team administration is an account identity, independent of platform privilege. */
export function isTeamAdmin(team: Pick<TeamResponse, 'admin'>, username: string | null | undefined, matrixUserId?: string | null): boolean {
  if (!team.admin) return false;
  if (team.admin.matrixUserId && matrixUserId) return team.admin.matrixUserId === matrixUserId;
  return Boolean(username && team.admin.name === username);
}
