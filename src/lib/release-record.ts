/**
 * Release records over Matrix room state events (PRD F3.3, Stateless-safe).
 *
 * 放行/撤销以房间状态事件 `com.agentteams.release` 承载：随房间权限继承、
 * 无服务端持久化域（Stateless 兼容）、天然审计线索。每次动作用独立
 * stateKey（`release-<ts>`）写入，历史不被覆盖（撤销生成新记录而非改写）。
 * 空间级配置（自动放行开关 F3.4）走 `com.agentteams.space`。
 */

import { matrixProxyFetch } from './matrix-write';

export const RELEASE_STATE_EVENT = 'com.agentteams.release';
export const SPACE_STATE_EVENT = 'com.agentteams.space';

export interface ReleaseRecord {
  action: 'release' | 'revoke';
  project_id?: string;
  task_id?: string;
  /** 审查轮次（放行只针对当前轮次的最新版本，PRD §7.2）。 */
  round?: number;
  actor: string;
  ts: number;
  note?: string;
}

export interface SpaceConfigRecord {
  auto_release?: boolean;
  updated_by?: string;
  ts: number;
}

interface RoomStateEventLike {
  type?: unknown;
  state_key?: unknown;
  content?: unknown;
}

function sortContent<T extends { ts: number }>(records: T[]): T[] {
  return [...records].sort((a, b) => a.ts - b.ts);
}

/**
 * 从房间全量 state 响应中提取指定自定义事件类型的内容列表（按 ts 升序）。
 * 兼容两种响应形态：事件数组（含 type/content）与纯 content 数组（旧版
 * homeserver 差异）——后者无法判型，安全返回空。
 */
export function extractStateRecords<T>(state: unknown, eventType: string): T[] {
  if (!Array.isArray(state)) return [];
  const contents: T[] = [];
  for (const entry of state) {
    if (!entry || typeof entry !== 'object') continue;
    const event = entry as RoomStateEventLike;
    if (event.type !== eventType) continue;
    if (event.content && typeof event.content === 'object') {
      contents.push(event.content as T);
    }
  }
  return contents;
}

/** 解析放行记录（剔除畸形条目，按 ts 升序）。 */
export function parseReleaseRecords(state: unknown): ReleaseRecord[] {
  const raw = extractStateRecords<Record<string, unknown>>(state, RELEASE_STATE_EVENT);
  const records: ReleaseRecord[] = [];
  for (const content of raw) {
    if (content.action !== 'release' && content.action !== 'revoke') continue;
    if (typeof content.actor !== 'string' || typeof content.ts !== 'number') continue;
    records.push({
      action: content.action,
      actor: content.actor,
      ts: content.ts,
      ...(typeof content.project_id === 'string' ? { project_id: content.project_id } : {}),
      ...(typeof content.task_id === 'string' ? { task_id: content.task_id } : {}),
      ...(typeof content.round === 'number' ? { round: content.round } : {}),
      ...(typeof content.note === 'string' ? { note: content.note } : {}),
    });
  }
  return sortContent(records);
}

/** 解析空间配置（自动放行开关 F3.4）。 */
export function parseSpaceConfig(state: unknown): SpaceConfigRecord | null {
  const raw = extractStateRecords<SpaceConfigRecord>(state, SPACE_STATE_EVENT);
  const latest = sortContent(raw.filter((c) => typeof c.ts === 'number')).pop();
  return latest ?? null;
}

/**
 * 当前工件态判定（F3.3）：有放行历史时以最新记录为准（release → released、
 * revoke → 回 draft），无历史回退任务状态推导。
 */
export function latestReleaseForTask(
  records: ReleaseRecord[],
  taskId?: string
): ReleaseRecord | undefined {
  const scoped = records.filter((r) => (taskId ? !r.task_id || r.task_id === taskId : true));
  return scoped[scoped.length - 1];
}

/** stateKey 生成：每次动作独立键，历史不覆盖。 */
export function releaseStateKey(action: ReleaseRecord['action']): string {
  return `${action}-${Date.now()}`;
}

/** 发送放行/撤销记录（经 BFF，服务端落 release.* 审计）。 */
export async function sendReleaseRecord(
  roomId: string,
  record: Omit<ReleaseRecord, 'ts'> & { ts?: number }
): Promise<void> {
  const res = await matrixProxyFetch(`/api/matrix/rooms/${encodeURIComponent(roomId)}/state-event`, {
    method: 'POST',
    body: JSON.stringify({
      eventType: RELEASE_STATE_EVENT,
      stateKey: releaseStateKey(record.action),
      content: { ...record, ts: record.ts ?? Date.now() },
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? `release record failed (${res.status})`);
  }
}

/** 更新空间配置（自动放行开关，经 BFF 落审计）。 */
export async function sendSpaceConfig(
  roomId: string,
  config: Partial<SpaceConfigRecord> & { ts?: number }
): Promise<void> {
  const res = await matrixProxyFetch(`/api/matrix/rooms/${encodeURIComponent(roomId)}/state-event`, {
    method: 'POST',
    body: JSON.stringify({
      eventType: SPACE_STATE_EVENT,
      stateKey: 'auto_release',
      content: { ...config, ts: config.ts ?? Date.now() },
    }),
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => null);
    throw new Error(detail?.error ?? `space config failed (${res.status})`);
  }
}

/** 读取房间全量 state（经现有 GET BFF）。 */
export async function fetchRoomState(roomId: string): Promise<unknown> {
  const res = await matrixProxyFetch(`/api/matrix/rooms/${encodeURIComponent(roomId)}/state`, {
    method: 'GET',
  });
  if (!res.ok) throw new Error(`room state failed (${res.status})`);
  return res.json();
}
