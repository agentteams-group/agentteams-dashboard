import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';

/**
 * 「团队与智能体」合并页的纯逻辑：成员归属、角色、计数、搜索命中、断点。
 *
 * 成员归属只有一条规则（全页共用）：`team.workerNames` 非空时以它为准；
 * 为空时回退到 `worker.team === team.name`。leader 一定来自 Worker 列表，
 * `TeamResponse.leaderName` 从来不是 Manager 名字。
 */

/**
 * 旧 `?tab=` / workers / teams 深链的初始选择意图（页面不再渲染页签，
 * 只把它翻译成一次性的初始选中：teams → 首个团队，agents → 独立 Worker）。
 */
export type TeamAgentsInitialIntent = 'teams' | 'agents';
/**
 * 三档多栏 + 单栏（容器宽度断点，A2）：
 * - triple        ≥1600  列表 + 拓扑 + Inspector 三栏；
 * - triple-compact 1200–1599 三栏（列宽收窄）；
 * - dual          840–1199  列表 + 拓扑两栏，Inspector 为右覆盖层；
 * - single        <840    单栏 drill-down（列表 → 拓扑 → 详情）。
 */
export type TeamAgentsLayout = 'triple' | 'triple-compact' | 'dual' | 'single';
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

/** 页面断点（A2，按容器宽度：triple ≥1600 / triple-compact 1200–1599 / dual 840–1199 / single <840）。 */
export const TRIPLE_MIN_WIDTH = 1600;
export const TRIPLE_COMPACT_MIN_WIDTH = 1200;
export const DUAL_MIN_WIDTH = 840;

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

/** 「拉起就绪」显示条件（插件 lifecycle 口径）：phase 不在 Running/Ready 才显，空 phase 视为未就绪。 */
export function shouldShowEnsureReady(phase: string | undefined | null): boolean {
  const p = (phase || '').trim().toLowerCase();
  return p !== 'running' && p !== 'ready';
}

/**
 * 团队行排序（插件 buildTeamRows 口径）：leader 名优先（无 leader 取首个
 * 成员名），再回落到团队名，中文排序。
 */
export function compareTeamRows(
  a: { team: TeamResponse },
  b: { team: TeamResponse },
  workers: WorkerResponse[] | undefined,
): number {
  const key = (team: TeamResponse): string => {
    const leader = leaderWorker(team, workers);
    const first = teamMemberWorkers(team, workers)[0];
    return (leader?.name || first?.name || team.name || '').toLowerCase();
  };
  return key(a.team).localeCompare(key(b.team), 'zh');
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

export function layoutForWidth(width: number): TeamAgentsLayout {
  if (width >= TRIPLE_MIN_WIDTH) return 'triple';
  if (width >= TRIPLE_COMPACT_MIN_WIDTH) return 'triple-compact';
  if (width >= DUAL_MIN_WIDTH) return 'dual';
  return 'single';
}

/** 内容区栅格列数（不含全局侧栏）：triple / triple-compact 3 / dual 2 / single 1。 */
export function contentColumnCount(layout: TeamAgentsLayout): 1 | 2 | 3 {
  if (layout === 'triple' || layout === 'triple-compact') return 3;
  if (layout === 'single') return 1;
  return 2;
}

/**
 * 栅格类（A2，测试按断点断言列定义，避免布局漂移）：
 * triple `[320px_1fr_420px]` / triple-compact `[280px_1fr_360px]` /
 * dual `[300px_1fr]`（Inspector 走右覆盖层，不占栅格列）/ single `grid-cols-1`。
 */
export function shellGridClass(layout: TeamAgentsLayout): string {
  switch (layout) {
    case 'triple':
      return 'grid-cols-[320px_minmax(0,1fr)_420px]';
    case 'triple-compact':
      return 'grid-cols-[280px_minmax(0,1fr)_360px]';
    case 'dual':
      return 'grid-cols-[300px_minmax(0,1fr)]';
    case 'single':
    default:
      return 'grid-cols-1';
  }
}

/** hash → 初始选择意图。`?tab=` 优先；旧的 workers/teams 路径别名兜底（默认 teams）。 */
export function teamAgentsInitialIntentFromHash(hash: string): TeamAgentsInitialIntent {
  const raw = hash.replace(/^#/, '');
  const [path, query] = raw.split('?');
  const param = new URLSearchParams(query ?? '').get('tab');
  if (param === 'agents' || param === 'teams') return param;
  if (path === 'workers' || path === 'console/resources/workers') return 'agents';
  if (path === 'teams' || path === 'console/resources/teams') return 'teams';
  return 'teams';
}

/**
 * 智能体卡片视图按团队分组：按 `team` 分桶，空团队 → `team: ''`（视图渲染
 * 「无团队」组）永远排最后；其余组按团队名 zh 排序；组内保持输入顺序
 * （调用方已按名称排好序）。
 */
export function groupAgentsByTeam<T extends { team?: string }>(
  agents: T[],
): Array<{ team: string; agents: T[] }> {
  const buckets = new Map<string, T[]>();
  for (const agent of agents) {
    const key = (agent.team ?? '').trim();
    const bucket = buckets.get(key);
    if (bucket) bucket.push(agent);
    else buckets.set(key, [agent]);
  }
  const keys = [...buckets.keys()];
  const ordered = [
    ...keys.filter((key) => key !== '').sort((a, b) => a.localeCompare(b, 'zh')),
    ...keys.filter((key) => key === ''),
  ];
  return ordered.map((key) => ({ team: key, agents: buckets.get(key)! }));
}

// ===== 智能体卡片：分组开关 / 排序偏好 / 整组分页（纯逻辑） =====

/** 智能体卡片排序键：分组开 = 团队名称 / Human 名称；分组关 = 智能体名称。 */
export type AgentSortKey = 'team' | 'admin' | 'name';
export type AgentSortDir = 'asc' | 'desc';
export interface AgentSortState {
  key: AgentSortKey;
  dir: AgentSortDir;
}

/** 当前分组模式下可选的排序键。 */
export function agentSortKeys(grouped: boolean): AgentSortKey[] {
  return grouped ? ['team', 'admin'] : ['name'];
}

/** 当前分组模式的默认排序键（升降序默认 asc）。 */
export function defaultAgentSortKey(grouped: boolean): AgentSortKey {
  return grouped ? 'team' : 'name';
}

/** localStorage `teamAgents.sort`（`team:asc` / `admin:desc` / `name:asc`）解析；非法值返回 null。 */
export function parseAgentSortPreference(raw: string | null): AgentSortState | null {
  if (!raw) return null;
  const parts = raw.split(':');
  if (parts.length !== 2) return null;
  const [key, dir] = parts;
  if (key !== 'team' && key !== 'admin' && key !== 'name') return null;
  if (dir !== 'asc' && dir !== 'desc') return null;
  return { key, dir };
}

/** 序列化为 `teamAgents.sort` 存储值。 */
export function formatAgentSortPreference(sort: AgentSortState): string {
  return `${sort.key}:${sort.dir}`;
}

/** 切换分组模式后当前键不适用时，回落到该模式默认键（dir 保留）。 */
export function fallbackAgentSort(sort: AgentSortState, grouped: boolean): AgentSortState {
  return agentSortKeys(grouped).includes(sort.key)
    ? sort
    : { key: defaultAgentSortKey(grouped), dir: sort.dir };
}

/**
 * 分组排序（分组开）：
 * - team：组名 zh 排序；「无团队」（team=''）恒排最后，与 dir 无关；
 * - admin：`team.admin` 名 zh 排序；无 admin 的组恒排最后（同档组名升序保底确定性）；
 * - name：分组模式下不参与组序（按 team 键处理）。
 */
export function sortAgentGroups<T extends { name: string; team?: string; adminName?: string }>(
  groups: Array<{ team: string; agents: T[] }>,
  key: AgentSortKey,
  dir: AgentSortDir,
): Array<{ team: string; agents: T[] }> {
  const direction = dir === 'asc' ? 1 : -1;
  const adminOf = (group: { team: string; agents: T[] }): string | undefined =>
    group.team === '' ? undefined : group.agents.find((agent) => agent.adminName)?.adminName;
  return [...groups].sort((a, b) => {
    const aNone = a.team === '';
    const bNone = b.team === '';
    if (aNone !== bNone) return aNone ? 1 : -1;
    const sortKey = key === 'name' ? 'team' : key;
    if (sortKey === 'admin') {
      const aAdmin = adminOf(a);
      const bAdmin = adminOf(b);
      const aRank = aAdmin ? 0 : 1;
      const bRank = bAdmin ? 0 : 1;
      if (aRank !== bRank) return aRank - bRank;
      if (aRank === 0 && bRank === 0) {
        const cmp = aAdmin!.localeCompare(bAdmin!, 'zh');
        if (cmp !== 0) return cmp * direction;
      }
    }
    const cmp = a.team.localeCompare(b.team, 'zh');
    if (cmp !== 0) return cmp * direction;
    return 0;
  });
}

/** 整组分页：组不跨页；单组超 pageSize 时独占一页（可溢出）。返回每页的组下标。 */
export function paginateGroupIndexes(counts: number[], pageSize = 12): number[][] {
  const pages: number[][] = [];
  let current: number[] = [];
  let currentCount = 0;
  counts.forEach((count, index) => {
    if (currentCount > 0 && currentCount + count > pageSize) {
      pages.push(current);
      current = [];
      currentCount = 0;
    }
    current.push(index);
    currentCount += count;
  });
  if (current.length > 0) pages.push(current);
  return pages;
}

/** 智能体卡片分页结果：`pages` 为全部页（每页 = 组块序列；分组关为单个 team='' 平铺块）。 */
export interface AgentPagingResult<T> {
  pages: Array<Array<{ team: string; agents: T[] }>>;
  totalPages: number;
  totalItems: number;
}

/**
 * 智能体卡片 ① 分页 + ④ 排序：
 * - 分组开 = 按整组切页（组不跨页；组内恒按智能体名升序，本函数内部排序）；
 * - 分组关 = 平铺数组按智能体名升/降序，每页 pageSize 条。
 */
export function paginateAgentCards<T extends { name: string; team?: string }>(
  agents: T[],
  teams: TeamResponse[],
  options: { grouped: boolean; sort: AgentSortState },
  pageSize = 12,
): AgentPagingResult<T> {
  const totalItems = agents.length;
  if (!options.grouped) {
    const direction = options.sort.dir === 'asc' ? 1 : -1;
    const sorted = [...agents].sort(
      (a, b) => a.name.localeCompare(b.name, 'zh') * direction,
    );
    const pages: Array<Array<{ team: string; agents: T[] }>> = [];
    for (let start = 0; start < sorted.length; start += pageSize) {
      pages.push([{ team: '', agents: sorted.slice(start, start + pageSize) }]);
    }
    return { pages, totalPages: Math.max(1, pages.length), totalItems };
  }
  const teamAdmins = new Map<string, string>();
  for (const team of teams) {
    const key = team.name ?? team.teamName ?? '';
    const admin = team.admin?.name;
    if (key && admin && !teamAdmins.has(key)) teamAdmins.set(key, admin);
  }
  const groups = groupAgentsByTeam(agents).map((group) => ({
    team: group.team,
    // 组内恒按智能体名称升序（与输入顺序无关）。
    agents: [...group.agents]
      .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
      .map((agent) => ({
        ...agent,
        adminName: group.team === '' ? undefined : teamAdmins.get(group.team),
      })),
  }));
  const sortedGroups = sortAgentGroups(
    groups,
    options.sort.key === 'name' ? 'team' : options.sort.key,
    options.sort.dir,
  );
  const indexPages = paginateGroupIndexes(
    sortedGroups.map((group) => group.agents.length),
    pageSize,
  );
  const pages = indexPages.map((indexes) => indexes.map((index) => sortedGroups[index]));
  return { pages, totalPages: Math.max(1, pages.length), totalItems };
}
