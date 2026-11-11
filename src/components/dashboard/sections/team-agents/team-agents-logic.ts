import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';

/**
 * 「团队与Agent」合并页的纯逻辑：成员归属、角色、计数、搜索命中、断点。
 *
 * 成员归属只有一条规则（全页共用）：`team.workerNames` 非空时以它为准；
 * 为空时回退到 `worker.team === team.name`。leader 一定来自 Worker 列表，
 * `TeamResponse.leaderName` 从来不是 Manager 名字。
 */

export type TeamAgentsTab = 'teams' | 'agents';
export type TeamAgentsLayout = 'xwide' | 'wide' | 'medium' | 'narrow';
export type TeamMemberRole = 'leader' | 'critic' | 'worker';

export interface TeamAgentMember {
  worker: WorkerResponse;
  role: TeamMemberRole;
}

export interface TeamAgentCounts {
  total: number;
  ready: number;
  sleeping: number;
  abnormal: number;
}

export interface TeamAgentRow {
  team: TeamResponse;
  /** 命中成员名（团队名/描述命中时为空数组），用于列表行提示。 */
  matchedMembers: string[];
}

/** 页面断点（方案：xwide ≥1440 / wide 1280–1439 / medium 1024–1279 / narrow <1024）。 */
export const XWIDE_MIN_WIDTH = 1440;
export const WIDE_MIN_WIDTH = 1280;
export const MEDIUM_MIN_WIDTH = 1024;

const READY_PHASES = new Set(['Running', 'Ready', 'Active']);
const SLEEPING_PHASES = new Set(['Sleeping', 'Stopped']);
const ABNORMAL_PHASES = new Set(['Failed', 'Degraded', 'Error']);

const CRITIC_ROLES = new Set(['critic', 'reviewer', 'review', '评审']);

export const ROLE_LABELS: Record<TeamMemberRole, string> = {
  leader: '负责人',
  critic: '评审',
  worker: '成员',
};

/** Worker 在团队里的展示角色；leader 由 team.leaderName 决定，其余看 worker.role。 */
export function memberRole(
  worker: Pick<WorkerResponse, 'name' | 'role'>,
  leaderName: string | undefined,
): TeamMemberRole {
  if (leaderName && worker.name === leaderName) return 'leader';
  if (worker.role && CRITIC_ROLES.has(worker.role)) return 'critic';
  return 'worker';
}

/**
 * 团队成员（唯一匹配规则）：`team.workerNames` 优先，空数组回退 `worker.team`。
 * leader 若在 Worker 列表中存在但尚未投影进 workerNames，仍置顶显示——否则
 * 拓扑上会出现「有 leader 名却没有 leader 行」。
 */
export function teamMemberWorkers(
  team: TeamResponse,
  workers: WorkerResponse[] | undefined,
): WorkerResponse[] {
  const list = workers ?? [];
  const byName = new Map(list.map((worker) => [worker.name, worker]));
  const declared = (team.workerNames ?? []).filter(Boolean);
  const names = declared.length
    ? declared
    : list.filter((worker) => worker.team === team.name).map((worker) => worker.name);

  const ordered = team.leaderName ? [team.leaderName, ...names] : names;
  const seen = new Set<string>();
  const result: WorkerResponse[] = [];
  for (const name of ordered) {
    if (seen.has(name)) continue;
    seen.add(name);
    const worker = byName.get(name);
    if (worker) result.push(worker);
  }
  return result;
}

/** 拓扑成员行：leader 置顶，其余保持 workerNames 顺序。 */
export function teamMembers(
  team: TeamResponse,
  workers: WorkerResponse[] | undefined,
): TeamAgentMember[] {
  return teamMemberWorkers(team, workers).map((worker) => ({
    worker,
    role: memberRole(worker, team.leaderName),
  }));
}

/** leader Worker（绝不查 Manager 列表）。 */
export function leaderWorker(
  team: TeamResponse,
  workers: WorkerResponse[] | undefined,
): WorkerResponse | null {
  if (!team.leaderName) return null;
  return (workers ?? []).find((worker) => worker.name === team.leaderName) ?? null;
}

export function memberSessionCount(worker: WorkerResponse): number | undefined {
  // Controller 尚未投影 sessionCount；存在即显示（见任务书「if available」）。
  const value = (worker as WorkerResponse & { sessionCount?: number }).sessionCount;
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined;
}

export function teamAgentCounts(members: TeamAgentMember[]): TeamAgentCounts {
  const counts: TeamAgentCounts = { total: members.length, ready: 0, sleeping: 0, abnormal: 0 };
  for (const { worker } of members) {
    if (READY_PHASES.has(worker.phase)) counts.ready += 1;
    else if (SLEEPING_PHASES.has(worker.phase)) counts.sleeping += 1;
    else if (ABNORMAL_PHASES.has(worker.phase)) counts.abnormal += 1;
  }
  return counts;
}

export function isAbnormalPhase(phase: string | undefined): boolean {
  return Boolean(phase && ABNORMAL_PHASES.has(phase));
}

/** 团队健康摘要（只按成员状态聚合，不引入第二套成员匹配规则）。 */
export function teamHealthLabel(counts: TeamAgentCounts): '健康' | '降级' | '异常' | '休眠' {
  if (counts.total === 0) return '降级';
  if (counts.abnormal > 0) return '异常';
  if (counts.ready === counts.total) return '健康';
  if (counts.sleeping === counts.total) return '休眠';
  return '降级';
}

function matches(value: string | undefined, query: string): boolean {
  return Boolean(value && value.toLowerCase().includes(query));
}

/**
 * 团队列表搜索：团队名/显示名/描述命中整行；否则保留成员名命中的团队，
 * 并带回命中成员名（列表行显示「匹配成员」）。
 */
export function filterTeamRows(
  teams: TeamResponse[] | undefined,
  workers: WorkerResponse[] | undefined,
  query: string,
): TeamAgentRow[] {
  const list = teams ?? [];
  const q = query.trim().toLowerCase();
  if (!q) return list.map((team) => ({ team, matchedMembers: [] }));

  const rows: TeamAgentRow[] = [];
  for (const team of list) {
    if (matches(team.name, q) || matches(team.teamName, q) || matches(team.description, q)) {
      rows.push({ team, matchedMembers: [] });
      continue;
    }
    const matchedMembers = teamMembers(team, workers)
      .filter(({ worker }) => matches(worker.name, q))
      .map(({ worker }) => worker.name);
    if (matchedMembers.length) rows.push({ team, matchedMembers });
  }
  return rows;
}

/** Agent 列表搜索：名字 / 团队 / 角色。空查询返回全量。 */
export function filterWorkerRows(
  workers: WorkerResponse[] | undefined,
  query: string,
): WorkerResponse[] {
  const list = workers ?? [];
  const q = query.trim().toLowerCase();
  if (!q) return list;
  return list.filter(
    (worker) =>
      matches(worker.name, q) || matches(worker.team, q) || matches(worker.role, q),
  );
}

export function layoutForWidth(width: number): TeamAgentsLayout {
  if (width >= XWIDE_MIN_WIDTH) return 'xwide';
  if (width >= WIDE_MIN_WIDTH) return 'wide';
  if (width >= MEDIUM_MIN_WIDTH) return 'medium';
  return 'narrow';
}

/** 内容区栅格列数（不含全局侧栏）：xwide 3 / wide 2 / medium 2 / narrow 1。 */
export function contentColumnCount(layout: TeamAgentsLayout): 1 | 2 | 3 {
  if (layout === 'xwide') return 3;
  if (layout === 'narrow') return 1;
  return 2;
}

/** 栅格类；测试按断点断言列定义，避免布局漂移。 */
export function shellGridClass(layout: TeamAgentsLayout): string {
  switch (layout) {
    case 'xwide':
      return 'grid-cols-[minmax(240px,300px)_minmax(0,1fr)_minmax(280px,340px)]';
    case 'wide':
      return 'grid-cols-[minmax(240px,300px)_minmax(0,1fr)]';
    case 'medium':
      return 'grid-cols-[minmax(220px,280px)_minmax(0,1fr)]';
    case 'narrow':
    default:
      return 'grid-cols-1';
  }
}

/** hash → tab。`?tab=` 优先；旧的 workers/teams 路径别名兜底。 */
export function teamAgentsTabFromHash(hash: string): TeamAgentsTab {
  const raw = hash.replace(/^#/, '');
  const [path, query] = raw.split('?');
  const param = new URLSearchParams(query ?? '').get('tab');
  if (param === 'agents' || param === 'teams') return param;
  if (path === 'workers' || path === 'console/resources/workers') return 'agents';
  if (path === 'teams' || path === 'console/resources/teams') return 'teams';
  return 'teams';
}
