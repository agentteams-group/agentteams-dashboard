import { describe, expect, it } from 'vitest';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import {
  compareTeamRows,
  contentColumnCount,
  filterTeamRows,
  layoutForWidth,
  leaderWorker,
  memberRole,
  memberSessionCount,
  shellGridClass,
  shouldShowEnsureReady,
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

describe('响应式断点 / 栅格', () => {
  it('maps widths to the four layouts at the documented breakpoints', () => {
    expect(layoutForWidth(1440)).toBe('xwide');
    expect(layoutForWidth(1439)).toBe('wide');
    expect(layoutForWidth(1280)).toBe('wide');
    expect(layoutForWidth(1279)).toBe('medium');
    expect(layoutForWidth(1024)).toBe('medium');
    expect(layoutForWidth(1023)).toBe('narrow');
    expect(layoutForWidth(375)).toBe('narrow');
  });

  it('renders 3 / 2 / 2 / 1 content columns (nav is the extra fourth on xwide)', () => {
    expect(contentColumnCount('xwide')).toBe(3);
    expect(contentColumnCount('wide')).toBe(2);
    expect(contentColumnCount('medium')).toBe(2);
    expect(contentColumnCount('narrow')).toBe(1);
    expect(shellGridClass('xwide')).toContain('_minmax(0,1fr)_');
    expect(shellGridClass('xwide').match(/minmax/g)).toHaveLength(3);
    expect(shellGridClass('narrow')).toBe('grid-cols-1');
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
