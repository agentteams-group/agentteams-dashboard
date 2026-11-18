import { describe, expect, it } from 'vitest';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import {
  agentSortKeys,
  compareTeamRows,
  contentColumnCount,
  defaultAgentSortKey,
  fallbackAgentSort,
  filterTeamRows,
  formatAgentSortPreference,
  groupAgentsByTeam,
  layoutForWidth,
  leaderWorker,
  memberRole,
  memberSessionCount,
  paginateAgentCards,
  paginateGroupIndexes,
  parseAgentSortPreference,
  shellGridClass,
  shouldShowEnsureReady,
  sortAgentGroups,
  teamAgentCounts,
  teamAgentsInitialIntentFromHash,
  teamHealthLabel,
  teamMemberWorkers,
  teamMembers,
} from './team-agents-logic';

function worker(name: string, patch: Partial<WorkerResponse> = {}): WorkerResponse {
  return {
    name,
    phase: 'Running',
    state: 'Running',
    containerManaged: true,
    model: `${name}-model`,
    runtime: 'qwenpaw',
    image: 'img:latest',
    containerState: 'running',
    matrixUserID: `@${name}:server`,
    roomID: `!${name}:server`,
    message: '',
    team: 'alpha',
    role: 'worker',
    ...patch,
  } as unknown as WorkerResponse;
}

function team(patch: Partial<TeamResponse> = {}): TeamResponse {
  return {
    name: 'alpha',
    teamName: 'Alpha',
    phase: 'Active',
    description: '',
    admin: null,
    humanMembers: [],
    leaderName: 'lead',
    leaderHeartbeat: null,
    workerIdleTimeout: '720m',
    teamRoomID: '!team:server',
    leaderDMRoomID: '!dm:server',
    leaderReady: true,
    readyWorkers: 2,
    totalWorkers: 2,
    message: '',
    workerNames: ['lead', 'w1'],
    workerExposedPorts: {},
    ...patch,
  } as unknown as TeamResponse;
}

describe('成员归属（唯一规则：workerNames 优先，worker.team 兜底）', () => {
  it('prefers team.workerNames even when worker.team disagrees', () => {
    const teamFixture = team({ workerNames: ['lead', 'w1'] });
    const workers = [worker('lead'), worker('w1', { team: 'other' }), worker('w2')];
    expect(teamMemberWorkers(teamFixture, workers).map((item) => item.name)).toEqual([
      'lead',
      'w1',
    ]);
  });

  it('falls back to worker.team when workerNames is empty', () => {
    const teamFixture = team({ workerNames: [], totalWorkers: 1 });
    const workers = [worker('lead'), worker('w1', { team: 'beta' })];
    expect(teamMemberWorkers(teamFixture, workers).map((item) => item.name)).toEqual(['lead']);
  });

  it('keeps the leader visible when the projection lags behind workerNames', () => {
    const teamFixture = team({ workerNames: ['w1'] });
    const workers = [worker('lead'), worker('w1')];
    expect(teamMemberWorkers(teamFixture, workers).map((item) => item.name)).toEqual([
      'lead',
      'w1',
    ]);
  });
});

describe('leader 语义', () => {
  it('resolves the leader from the Worker list (never from Managers)', () => {
    const teamFixture = team({ leaderName: 'lead', admin: { name: 'boss' } });
    const workers = [worker('lead'), worker('boss', { role: 'manager' })];
    expect(leaderWorker(teamFixture, workers)?.name).toBe('lead');
    // team.admin 只用于 Manager 展示，不参与 leader 解析。
    expect(teamFixture.admin?.name).toBe('boss');
    expect(leaderWorker(teamFixture, [worker('boss')])).toBeNull();
  });

  it('labels the leader row and critic rows', () => {
    expect(memberRole({ name: 'lead', role: 'worker' }, 'lead')).toBe('leader');
    expect(memberRole({ name: 'c1', role: 'critic' }, 'lead')).toBe('critic');
    expect(memberRole({ name: 'w1', role: 'worker' }, 'lead')).toBe('worker');
    const members = teamMembers(team(), [worker('w1'), worker('lead'), worker('c1', { role: 'critic', team: 'alpha' })]);
    expect(members[0]?.role).toBe('leader');
    expect(members.map((member) => member.worker.name)).toEqual(['lead', 'w1']);
  });
});

describe('状态与计数', () => {
  it('counts ready / sleeping / abnormal members and derives a health label', () => {
    const workers = [
      worker('lead', { phase: 'Running' }),
      worker('w1', { phase: 'Sleeping' }),
      worker('w2', { phase: 'Failed' }),
    ];
    const members = teamMembers(team({ workerNames: ['lead', 'w1', 'w2'], totalWorkers: 3 }), workers);
    expect(teamAgentCounts(members)).toEqual({ total: 3, ready: 1, sleeping: 1, abnormal: 1 });
    expect(teamHealthLabel(teamAgentCounts(members))).toBe('异常');
    expect(teamHealthLabel(teamAgentCounts(members.slice(0, 2)))).toBe('降级');
    expect(
      teamHealthLabel(teamAgentCounts([{ worker: worker('lead'), role: 'leader' }])),
    ).toBe('健康');
  });

  it('reads an optional session count only when the controller projects it', () => {
    expect(memberSessionCount(worker('w1'))).toBeUndefined();
    expect(
      memberSessionCount({ ...worker('w1'), sessionCount: 3 } as WorkerResponse),
    ).toBe(3);
  });
});

describe('搜索/筛选', () => {
  it('keeps teams with matched members and reports the matched names', () => {
    const alpha = team({ name: 'alpha', workerNames: ['lead', 'designer'] });
    const beta = team({ name: 'beta', leaderName: 'lead2', workerNames: ['lead2'] });
    const workers = [worker('lead'), worker('designer'), worker('lead2', { team: 'beta' })];
    const rows = filterTeamRows([alpha, beta], workers, 'design');
    expect(rows).toHaveLength(1);
    expect(rows[0]?.team.name).toBe('alpha');
    expect(rows[0]?.matchedMembers).toEqual(['designer']);
  });

  it('keeps the whole team when the team name itself matches', () => {
    const rows = filterTeamRows([team({ name: 'alpha' })], [worker('lead')], 'alph');
    expect(rows[0]?.matchedMembers).toEqual([]);
  });

});

describe('团队行排序（插件口径：leader 名优先，中文排序）', () => {
  it('sorts by leader name, falling back to first member / team name', () => {
    const alpha = team({ name: 'alpha', leaderName: 'zeta', workerNames: ['zeta', 'w1'] });
    const beta = team({ name: 'beta', leaderName: 'alpha-lead', workerNames: ['alpha-lead'] });
    const workers = [worker('zeta'), worker('alpha-lead'), worker('w1')];
    // 按团队名排序会是 alpha < beta；按 leader 名应为 alpha-lead < zeta。
    const sorted = [{ team: alpha }, { team: beta }].sort((a, b) =>
      compareTeamRows(a, b, workers),
    );
    expect(sorted.map((row) => row.team.name)).toEqual(['beta', 'alpha']);

    const noLeader = team({ name: 'gamma', leaderName: '', workerNames: ['b-worker'] });
    const rows = [{ team: noLeader }, { team: alpha }].sort((a, b) =>
      compareTeamRows(a, b, [worker('b-worker'), worker('zeta')]),
    );
    expect(rows.map((row) => row.team.name)).toEqual(['gamma', 'alpha']);
  });
});

describe('拉起就绪显示条件（B4 / 插件 lifecycle 口径）', () => {
  it('shows for Pending/Stopped/empty and hides for Running/Ready (case-insensitive)', () => {
    expect(shouldShowEnsureReady('Pending')).toBe(true);
    expect(shouldShowEnsureReady('Stopped')).toBe(true);
    expect(shouldShowEnsureReady('Sleeping')).toBe(true);
    expect(shouldShowEnsureReady('')).toBe(true);
    expect(shouldShowEnsureReady(undefined)).toBe(true);
    expect(shouldShowEnsureReady('Running')).toBe(false);
    expect(shouldShowEnsureReady('running ')).toBe(false);
    expect(shouldShowEnsureReady('READY')).toBe(false);
  });
});

describe('A2 响应式断点 / 栅格', () => {
  it('maps container widths to the four layouts at the documented breakpoints', () => {
    expect(layoutForWidth(1920)).toBe('triple');
    expect(layoutForWidth(1600)).toBe('triple');
    expect(layoutForWidth(1599)).toBe('triple-compact');
    expect(layoutForWidth(1200)).toBe('triple-compact');
    expect(layoutForWidth(1199)).toBe('dual');
    expect(layoutForWidth(840)).toBe('dual');
    expect(layoutForWidth(839)).toBe('single');
    expect(layoutForWidth(375)).toBe('single');
  });

  it('renders 3 / 3 / 2 / 1 content columns (dual 的 Inspector 走覆盖层)', () => {
    expect(contentColumnCount('triple')).toBe(3);
    expect(contentColumnCount('triple-compact')).toBe(3);
    expect(contentColumnCount('dual')).toBe(2);
    expect(contentColumnCount('single')).toBe(1);
    expect(shellGridClass('triple')).toBe('grid-cols-[320px_minmax(0,1fr)_420px]');
    expect(shellGridClass('triple-compact')).toBe('grid-cols-[280px_minmax(0,1fr)_360px]');
    expect(shellGridClass('dual')).toBe('grid-cols-[300px_minmax(0,1fr)]');
    expect(shellGridClass('single')).toBe('grid-cols-1');
  });
});

describe('hash → 初始选择意图（旧路由别名，无页签 UI）', () => {
  it('maps legacy workers/teams paths to the merged page intent', () => {
    expect(teamAgentsInitialIntentFromHash('#console/resources/workers')).toBe('agents');
    expect(teamAgentsInitialIntentFromHash('#console/resources/teams')).toBe('teams');
    expect(teamAgentsInitialIntentFromHash('#workers')).toBe('agents');
    expect(teamAgentsInitialIntentFromHash('#teams')).toBe('teams');
  });

  it('prefers the explicit tab query and defaults to teams', () => {
    expect(teamAgentsInitialIntentFromHash('#console/resources/team-agents?tab=agents')).toBe('agents');
    expect(teamAgentsInitialIntentFromHash('#console/resources/team-agents')).toBe('teams');
    expect(teamAgentsInitialIntentFromHash('')).toBe('teams');
  });
});

describe('智能体卡片按团队分组（③：组按团队名排序，无团队永远最后，组内保序）', () => {
  it('buckets by team and orders groups by name, ungrouped last', () => {
    const groups = groupAgentsByTeam([
      worker('solo', { team: '' }),
      worker('b1', { team: 'zeta' }),
      worker('a1', { team: 'alpha' }),
      worker('a2', { team: 'alpha' }),
      worker('b2', { team: 'zeta' }),
    ]);
    // 输入顺序是 zeta 在前，输出按团队名排序（alpha < zeta），与输入顺序无关。
    expect(groups.map((group) => group.team)).toEqual(['alpha', 'zeta', '']);
    expect(groups[0]?.agents.map((agent) => agent.name)).toEqual(['a1', 'a2']);
    expect(groups[1]?.agents.map((agent) => agent.name)).toEqual(['b1', 'b2']);
    expect(groups[2]?.agents.map((agent) => agent.name)).toEqual(['solo']);
  });

  it('normalizes blank and missing team values into the ungrouped bucket', () => {
    const groups = groupAgentsByTeam([
      worker('w1', { team: '   ' }),
      worker('w2', { team: undefined }),
      worker('w3', { team: 'alpha' }),
    ]);
    expect(groups.map((group) => group.team)).toEqual(['alpha', '']);
    expect(groups[1]?.agents.map((agent) => agent.name)).toEqual(['w1', 'w2']);
  });

  it('returns a single ungrouped bucket when every agent has no team', () => {
    const groups = groupAgentsByTeam([worker('s1', { team: '' }), worker('s2', { team: '' })]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.team).toBe('');
    expect(groups[0]?.agents.map((agent) => agent.name)).toEqual(['s1', 's2']);
  });
});

describe('智能体卡片：排序键 / 偏好解析 / 模式回落（④）', () => {
  it('offers team/admin keys when grouped and name key when flat', () => {
    expect(agentSortKeys(true)).toEqual(['team', 'admin']);
    expect(agentSortKeys(false)).toEqual(['name']);
    expect(defaultAgentSortKey(true)).toBe('team');
    expect(defaultAgentSortKey(false)).toBe('name');
  });

  it('parses and serializes teamAgents.sort, rejecting malformed values', () => {
    expect(parseAgentSortPreference('team:asc')).toEqual({ key: 'team', dir: 'asc' });
    expect(parseAgentSortPreference('admin:desc')).toEqual({ key: 'admin', dir: 'desc' });
    expect(parseAgentSortPreference('name:desc')).toEqual({ key: 'name', dir: 'desc' });
    expect(parseAgentSortPreference(null)).toBeNull();
    expect(parseAgentSortPreference('')).toBeNull();
    expect(parseAgentSortPreference('team')).toBeNull();
    expect(parseAgentSortPreference('team:up')).toBeNull();
    expect(parseAgentSortPreference('bogus:asc')).toBeNull();
    expect(parseAgentSortPreference('team:asc:extra')).toBeNull();
    expect(formatAgentSortPreference({ key: 'team', dir: 'asc' })).toBe('team:asc');
    expect(formatAgentSortPreference(parseAgentSortPreference('admin:desc')!)).toBe('admin:desc');
  });

  it('falls back to the mode default key when the key no longer applies (dir kept)', () => {
    expect(fallbackAgentSort({ key: 'team', dir: 'asc' }, false)).toEqual({ key: 'name', dir: 'asc' });
    expect(fallbackAgentSort({ key: 'admin', dir: 'desc' }, false)).toEqual({ key: 'name', dir: 'desc' });
    expect(fallbackAgentSort({ key: 'name', dir: 'desc' }, true)).toEqual({ key: 'team', dir: 'desc' });
    expect(fallbackAgentSort({ key: 'team', dir: 'desc' }, true)).toEqual({ key: 'team', dir: 'desc' });
    expect(fallbackAgentSort({ key: 'name', dir: 'asc' }, false)).toEqual({ key: 'name', dir: 'asc' });
  });
});

describe('智能体卡片：组排序（④：无团队恒最后，无 admin 组恒最后）', () => {
  const groups = [
    { team: 'zeta', agents: [{ ...worker('z1'), adminName: 'alice' }] },
    { team: 'alpha', agents: [{ ...worker('a1'), adminName: 'carol' }] },
    { team: 'mid', agents: [worker('m1')] },
    { team: '', agents: [worker('solo')] },
  ];

  it('sorts by team name, ungrouped last in both directions', () => {
    expect(sortAgentGroups(groups, 'team', 'asc').map((group) => group.team)).toEqual([
      'alpha',
      'mid',
      'zeta',
      '',
    ]);
    expect(sortAgentGroups(groups, 'team', 'desc').map((group) => group.team)).toEqual([
      'zeta',
      'mid',
      'alpha',
      '',
    ]);
  });

  it('sorts by admin name, no-admin groups (and ungrouped) last, name tiebreak within tiers', () => {
    expect(sortAgentGroups(groups, 'admin', 'asc').map((group) => group.team)).toEqual([
      'zeta', // alice
      'alpha', // carol
      'mid', // 无 admin
      '',
    ]);
    expect(sortAgentGroups(groups, 'admin', 'desc').map((group) => group.team)).toEqual([
      'alpha',
      'zeta',
      'mid',
      '',
    ]);
  });

  it('treats the name key as the team key in grouped mode', () => {
    expect(sortAgentGroups(groups, 'name', 'asc').map((group) => group.team)).toEqual(
      sortAgentGroups(groups, 'team', 'asc').map((group) => group.team),
    );
  });
});

describe('智能体卡片：整组分页（①：组不跨页，单组超页可溢出）', () => {
  it('keeps whole groups on one page', () => {
    expect(paginateGroupIndexes([5, 4, 3], 12)).toEqual([[0, 1, 2]]);
    expect(paginateGroupIndexes([5, 4, 3], 8)).toEqual([[0], [1, 2]]);
    expect(paginateGroupIndexes([12, 1], 12)).toEqual([[0], [1]]);
    expect(paginateGroupIndexes([], 12)).toEqual([]);
  });

  it('lets a single group overflow its page instead of splitting it', () => {
    expect(paginateGroupIndexes([20], 12)).toEqual([[0]]);
    expect(paginateGroupIndexes([20, 2], 12)).toEqual([[0], [1]]);
  });
});

describe('智能体卡片：分页 + 排序入口 paginateAgentCards（①④）', () => {
  const makeAgents = (name: string, team: string, count: number) =>
    Array.from({ length: count }, (_, index) => worker(`${name}-${String(index + 1).padStart(2, '0')}`, { team }));

  it('flat mode pages by 12 name-ordered items (asc/desc), single bucket per page', () => {
    const agents = makeAgents('a', 'alpha', 14);
    const asc = paginateAgentCards(agents, [], { grouped: false, sort: { key: 'name', dir: 'asc' } }, 12);
    expect(asc.totalItems).toBe(14);
    expect(asc.totalPages).toBe(2);
    expect(asc.pages[0]?.[0]?.team).toBe('');
    expect(asc.pages[0]?.[0]?.agents.map((agent) => agent.name)).toEqual(
      agents.map((agent) => agent.name).sort((x, y) => x.localeCompare(y, 'zh')),
    );
    expect(asc.pages[1]?.[0]?.agents).toHaveLength(2);
    const desc = paginateAgentCards(agents, [], { grouped: false, sort: { key: 'name', dir: 'desc' } }, 12);
    expect(desc.pages[0]?.[0]?.agents.map((agent) => agent.name)).toEqual(
      asc.pages[0]?.[0]?.agents.map((agent) => agent.name).reverse(),
    );
  });

  it('grouped mode pages by whole group: 31 agents in 12/12/7 become 3 pages, no group crosses pages', () => {
    const teams = [
      team({ name: 'alpha', admin: { name: 'carol' } }),
      team({ name: 'beta', admin: null }),
    ];
    const agents = [
      ...makeAgents('a', 'alpha', 12),
      ...makeAgents('b', 'beta', 12),
      ...makeAgents('n', '', 7),
    ];
    const result = paginateAgentCards(agents, teams, { grouped: true, sort: { key: 'team', dir: 'asc' } }, 12);
    expect(result.totalItems).toBe(31);
    expect(result.totalPages).toBe(3);
    expect(result.pages.map((page) => page.map((group) => group.team))).toEqual([
      ['alpha'],
      ['beta'],
      [''],
    ]);
    // 组内恒按智能体名称升序（即使输入乱序）。
    const shuffled = [
      ...makeAgents('a', 'alpha', 12).sort((x, y) => y.name.localeCompare(x.name, 'zh')),
      ...makeAgents('b', 'beta', 12),
      ...makeAgents('n', '', 7),
    ];
    const rerun = paginateAgentCards(shuffled, teams, { grouped: true, sort: { key: 'team', dir: 'asc' } }, 12);
    expect(rerun.pages[0]?.[0]?.agents.map((agent) => agent.name)).toEqual(
      makeAgents('a', 'alpha', 12).map((agent) => agent.name).sort((x, y) => x.localeCompare(y, 'zh')),
    );
  });

  it('grouped mode orders by admin with no-admin teams last', () => {
    const teams = [
      team({ name: 'alpha', admin: { name: 'carol' } }),
      team({ name: 'beta', admin: null }),
    ];
    const agents = [...makeAgents('a', 'alpha', 3), ...makeAgents('b', 'beta', 3)];
    const result = paginateAgentCards(agents, teams, { grouped: true, sort: { key: 'admin', dir: 'asc' } }, 12);
    expect(result.pages[0]?.map((group) => group.team)).toEqual(['alpha', 'beta']);
    const desc = paginateAgentCards(agents, teams, { grouped: true, sort: { key: 'admin', dir: 'desc' } }, 12);
    // beta 无 admin，升降序都恒在最后。
    expect(desc.pages[0]?.map((group) => group.team)).toEqual(['alpha', 'beta']);
  });

  it('returns one empty page for an empty agent list', () => {
    const result = paginateAgentCards([], [], { grouped: true, sort: { key: 'team', dir: 'asc' } }, 12);
    expect(result.totalItems).toBe(0);
    expect(result.totalPages).toBe(1);
    expect(result.pages).toEqual([]);
  });
});
