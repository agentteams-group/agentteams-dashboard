import { matrixApi } from '@/lib/matrix-api';

/**
 * Last activity timestamp (ms) of a project's Matrix room — the third
 * fallback source of a project's "activity time", same semantics as the
 * plugin's projectActivityTs third source (room last_ts).
 *
 * Why this exists: the controller's ListProjects projectSummary returns NO
 * timestamps (source-verified: struct carries project_id/title/status/
 * plan_type/team_id/mode only) and generated project ids are `proj-<uuid>`
 * (no embedded date) — so the board's "时间 新→旧" sort had no data at all
 * and silently degraded to name order. The project room's latest message is
 * the freshest activity signal available without a controller change.
 *
 * Returns 0 for unknown/empty/unreadable rooms; callers treat 0 as
 * "no timestamp" (name-order fallback) — a failure must never break the
 * board, and a limit-1 backward fetch keeps this one cheap request per room.
 */
export async function fetchProjectRoomTs(
  homeserver: string,
  accessToken: string,
  roomId: string,
): Promise<number> {
  if (!homeserver || !accessToken || !roomId) return 0;
  try {
    const res = await matrixApi.getRoomMessages(homeserver, accessToken, roomId, {
      dir: 'b',
      limit: 1,
    });
    return res.chunk[0]?.origin_server_ts ?? 0;
  } catch {
    return 0;
  }
}
