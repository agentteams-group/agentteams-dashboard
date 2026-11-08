import { describe, expect, it } from 'vitest';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import { pickLlmTuning } from '@/lib/llm-tuning';
import {
  applyBatchModel,
  buildBasicDraft,
  buildBasicUpdate,
  buildMemberRows,
  buildMemberUpdate,
  changedMemberModels,
  diffSkillAssignments,
  mergeMember,
  missingMemberNames,
  skillColumns,
  skillValuesFor,
  standaloneWorkers,
} from './team-drawer-logic';

const worker = (name: string, model = '', skills: string[] = []) =>
  ({ name, model, skills, team: 'alpha' }) as unknown as WorkerResponse;

const team = (patch: Partial<TeamResponse> = {}) =>
  ({
    name: 'alpha',
    teamName: 'Alpha',
    phase: 'Active',
    description: '',
    admin: null,
    humanMembers: [],
    leaderName: 'lead',
    leaderHeartbeat: null,
    workerIdleTimeout: '720m',
    teamRoomID: '!room:server',
    leaderDMRoomID: '!dm:server',
    leaderReady: true,
    readyWorkers: 2,
    totalWorkers: 2,
    message: '',
    peerMentions: true,
    workerNames: ['w1', 'w2'],
    workerExposedPorts: {},
    ...patch,
  }) as TeamResponse;

describe('team-drawer-logic · members', () => {
  it('builds leader-first rows with models and missing references flagged', () => {
    const rows = buildMemberRows(team(), [worker('lead', 'm-lead'), worker('w1', 'm1')]);
    expect(rows.map((row) => [row.name, row.role, row.model, row.missing])).toEqual([
      ['lead', 'team_leader', 'm-lead', false],
      ['w1', 'worker', 'm1', false],
      ['w2', 'worker', '', true],
    ]);
    expect(missingMemberNames(rows)).toEqual(['w2']);
  });

  it('batch paint only touches the requested role and empty value is a no-op', () => {
    const rows = buildMemberRows(team({ workerNames: ['w1'] }), [
      worker('lead', 'm-lead'),
      worker('w1', 'm1'),
    ]);
    const leaderOnly = applyBatchModel(rows, 'team_leader', 'batch-leader');
    expect(leaderOnly.map((row) => row.model)).toEqual(['batch-leader', 'm1']);
    const workerOnly = applyBatchModel(rows, 'worker', 'batch-worker');
    expect(workerOnly.map((row) => row.model)).toEqual(['m-lead', 'batch-worker']);
    expect(applyBatchModel(rows, 'worker', '  ')).toBe(rows);
  });

  it('collects only changed rows with a non-empty model', () => {
    const rows = buildMemberRows(team({ workerNames: ['w1', 'w2'] }), [
      worker('lead', 'm-lead'),
      worker('w1', 'm1'),
      worker('w2', 'm2'),
    ]);
    const next = rows.map((row) =>
      row.name === 'w2' ? { ...row, model: 'm2-new' } : row.name === 'w1' ? { ...row, model: '' } : row,
    );
    expect(changedMemberModels(next)).toEqual([{ name: 'w2', model: 'm2-new' }]);
  });

  it('builds workerMembers payload with leader kept out of workerNames', () => {
    const rows = buildMemberRows(team({ workerNames: ['w1', 'w1', 'lead'] }), [
      worker('lead'),
      worker('w1'),
    ]);
    const rowsWithDup = [...rows, { ...rows[0] }];
    expect(buildMemberUpdate(rowsWithDup)).toEqual({ leader: { name: 'lead' }, workerNames: ['w1'] });
    expect(buildMemberUpdate([{ ...rows[1], name: '' }])).toEqual({ leader: null, workerNames: [] });
  });

  it('merges a standalone worker without dropping existing members', () => {
    const rows = buildMemberRows(team(), [worker('lead'), worker('w1'), worker('w2')]);
    const merged = mergeMember(rows, worker('w9', 'm9'));
    expect(merged.map((row) => row.name)).toEqual(['lead', 'w1', 'w2', 'w9']);
    expect(merged[3]).toMatchObject({ model: 'm9', baseModel: 'm9', role: 'worker' });
    expect(mergeMember(merged, worker('w9', 'm9'))).toBe(merged);
  });
});

describe('team-drawer-logic · basic info + LLM', () => {
  it('sends only changed fields, including empty description (explicit clear)', () => {
    const current = team({ description: '原描述' });
    const draft = buildBasicDraft(current);
    expect(buildBasicUpdate(current, draft, pickLlmTuning(current))).toEqual({});

    const changed = buildBasicUpdate(
      current,
      { ...draft, teamName: 'Alpha2', description: '', workerIdleTimeout: '30m', peerMentions: false },
      pickLlmTuning(current),
    );
    expect(changed).toEqual({
      teamName: 'Alpha2',
      description: '',
      workerIdleTimeout: '30m',
      peerMentions: false,
    });
  });

  it('folds team-level LLM tuning diffs into the same PUT payload', () => {
    const current = team({ llmMaxRetries: '3' });
    const llm = { ...pickLlmTuning(current), llmMaxRetries: '5', llmMaxQpm: '30' };
    expect(buildBasicUpdate(current, buildBasicDraft(current), llm)).toEqual({
      llmMaxRetries: '5',
      llmMaxQpm: '30',
    });
  });

  it('omits peerMentions when the server does not project it', () => {
    const current = { ...team(), peerMentions: undefined } as TeamResponse;
    expect(buildBasicDraft(current).peerMentions).toBeUndefined();
    expect(
      buildBasicUpdate(current, { ...buildBasicDraft(current), peerMentions: true }, pickLlmTuning(current)),
    ).toEqual({});
  });
});

describe('team-drawer-logic · standalone workers + skills', () => {
  it('lists workers not referenced by any team (leader or member)', () => {
    const other = team({ name: 'beta', leaderName: 'b-lead', workerNames: ['b-w'] });
    const workers = [worker('lead'), worker('w1'), worker('b-lead'), worker('b-w'), worker('free')];
    expect(standaloneWorkers([team(), other], workers).map((item) => item.name)).toEqual(['free']);
  });

  it('diffs skill assignments by set, ignoring order and untouched workers', () => {
    const baseline = { w1: ['a', 'b'], w2: ['c'] };
    expect(diffSkillAssignments(baseline, {})).toEqual([]);
    expect(diffSkillAssignments(baseline, { w1: ['b', 'a'] })).toEqual([]);
    expect(diffSkillAssignments(baseline, { w1: ['a'], w2: ['c', 'd'] })).toEqual([
      { name: 'w1', skills: ['a'] },
      { name: 'w2', skills: ['c', 'd'] },
    ]);
  });

  it('draft wins over baseline and columns keep catalog + strays', () => {
    const baseline = { w1: ['stray'] };
    expect(skillValuesFor({ w1: ['s1'] }, baseline, 'w1')).toEqual(['s1']);
    expect(skillValuesFor({}, baseline, 'w1')).toEqual(['stray']);
    expect(skillColumns(['s1', 's2'], { w1: ['s1', 's3'] }, baseline)).toEqual([
      's1',
      's2',
      's3',
      'stray',
    ]);
  });
});
