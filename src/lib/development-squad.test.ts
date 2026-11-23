import { beforeEach, describe, expect, it, vi } from 'vitest';
import { unzipSync, strFromU8 } from 'fflate';
import { ApiError } from './api-error';
import { agentteamsApi, type TeamResponse, type WorkerResponse } from './agentteams-api';
import { DEVELOPMENT_ROLES, deploymentAgents, deployDevelopmentSquad } from './development-squad';

vi.mock('./agentteams-api', () => ({
  agentteamsApi: {
    listWorkers: vi.fn(), listTeams: vi.fn(), getSkill: vi.fn(), createSkill: vi.fn(),
    downloadSkill: vi.fn(), createWorker: vi.fn(), getWorker: vi.fn(),
    uploadWorkerSkill: vi.fn(), updateWorker: vi.fn(), createTeam: vi.fn(), getDevelopmentSquadSkills: vi.fn(),
  },
}));

const workers = new Map<string, WorkerResponse>();
const assets = new Map<string, File>();
let team: TeamResponse | undefined;

beforeEach(() => {
  vi.resetAllMocks(); workers.clear(); assets.clear(); team = undefined;
  vi.mocked(agentteamsApi.listWorkers).mockImplementation(async () => [...workers.values()]);
  vi.mocked(agentteamsApi.listTeams).mockImplementation(async () => team ? [team] : []);
  vi.mocked(agentteamsApi.getWorker).mockImplementation(async name => workers.get(name)!);
  vi.mocked(agentteamsApi.getDevelopmentSquadSkills).mockResolvedValue({
    version: '1.0.0', skills: DEVELOPMENT_ROLES.map(role => ({ name: role.skillName,
      content: `---\nname: ${role.skillName}\ndescription: ${role.description}\n---\nYou perform your assigned role.`,
    })),
  });
  vi.mocked(agentteamsApi.getSkill).mockImplementation(async name => {
    if (!assets.has(name)) throw new ApiError('not found', 404, '/skills');
    return { name } as Awaited<ReturnType<typeof agentteamsApi.getSkill>>;
  });
  vi.mocked(agentteamsApi.createSkill).mockImplementation(async file => {
    const name = file.name.replace(/\.zip$/, ''); assets.set(name, file);
    return { name, success: true } as Awaited<ReturnType<typeof agentteamsApi.createSkill>>;
  });
  vi.mocked(agentteamsApi.downloadSkill).mockImplementation(async name => assets.get(name)!);
  vi.mocked(agentteamsApi.createWorker).mockImplementation(async data => {
    const worker = { ...data, model: 'cluster-default' } as WorkerResponse;
    workers.set(data.name, worker); return worker;
  });
  vi.mocked(agentteamsApi.uploadWorkerSkill).mockImplementation(async (_name, file) => ({
    success: true, skillName: file.name.replace(/\.zip$/, ''),
  }) as Awaited<ReturnType<typeof agentteamsApi.uploadWorkerSkill>>);
  vi.mocked(agentteamsApi.updateWorker).mockImplementation(async (name, data) => {
    const worker = { ...workers.get(name)!, ...data };
    workers.set(name, worker); return worker;
  });
  vi.mocked(agentteamsApi.createTeam).mockImplementation(async data => {
    team = { name: data.name, leaderName: data.leader!.name, workerNames: data.workerNames } as TeamResponse;
    return team;
  });
});

describe('development squad deployment', () => {
  it('stores four reusable assets, associates canonical packages, then starts the team with the cluster default model', async () => {
    await deployDevelopmentSquad('dev-team');
    expect(assets.size).toBe(4);
    expect(workers.size).toBe(4);
    for (const role of DEVELOPMENT_ROLES) {
      const name = `dev-team-${role.id}`;
      expect(agentteamsApi.createWorker).toHaveBeenCalledWith(expect.objectContaining({
        name, state: 'Stopped', skills: [role.skillName], runtime: 'openclaw',
      }));
      const payload = vi.mocked(agentteamsApi.createWorker).mock.calls.find(([x]) => x.name === name)![0];
      expect(payload).not.toHaveProperty('model');
      expect(agentteamsApi.uploadWorkerSkill).toHaveBeenCalledWith(name, assets.get(role.skillName), 'openclaw', { restart: false });
      expect(workers.get(name)?.skills).toContain(role.skillName);
      expect(workers.get(name)?.state).toBe('Running');
      const files = unzipSync(new Uint8Array(await assets.get(role.skillName)!.arrayBuffer()));
      expect(strFromU8(files[`${role.skillName}/SKILL.md`])).toContain('You');
    }
    expect(team).toMatchObject({ leaderName: 'dev-team-leader', workerNames: expect.arrayContaining(['dev-team-developer', 'dev-team-reviewer', 'dev-team-tester']) });
    const started = vi.mocked(agentteamsApi.updateWorker).mock.calls
      .map(([, body], i) => body.state === 'Running' ? vi.mocked(agentteamsApi.updateWorker).mock.invocationCallOrder[i] : 0).filter(Boolean);
    expect(Math.min(...started)).toBeGreaterThan(vi.mocked(agentteamsApi.createTeam).mock.invocationCallOrder[0]);
  });

  it('reuses existing asset edits and never overwrites them', async () => {
    await deployDevelopmentSquad('dev-team');
    vi.mocked(agentteamsApi.createSkill).mockClear();
    const canonical = new File(['edited asset'], `${DEVELOPMENT_ROLES[0].skillName}.zip`);
    assets.set(DEVELOPMENT_ROLES[0].skillName, canonical);
    await deployDevelopmentSquad('second');
    expect(agentteamsApi.createSkill).not.toHaveBeenCalled();
    expect(agentteamsApi.uploadWorkerSkill).toHaveBeenCalledWith('second-leader', canonical, 'openclaw', { restart: false });
  });

  it('preserves partial deployment and safely resumes without duplicate workers or assets', async () => {
    vi.mocked(agentteamsApi.uploadWorkerSkill).mockRejectedValueOnce(new Error('storage unavailable'));
    await expect(deployDevelopmentSquad('retry')).rejects.toThrow('storage unavailable');
    expect(agentteamsApi.createTeam).not.toHaveBeenCalled();
    expect([...workers.values()].every(x => x.state === 'Stopped')).toBe(true);
    await deployDevelopmentSquad('retry');
    const count = vi.mocked(agentteamsApi.createWorker).mock.calls.length;
    await deployDevelopmentSquad('retry');
    expect(agentteamsApi.createWorker).toHaveBeenCalledTimes(count);
    expect(agentteamsApi.createTeam).toHaveBeenCalledTimes(1);
    expect(assets.size).toBe(4);
  });

  it('rejects an unrelated existing worker or team before changing resources', async () => {
    workers.set('taken-developer', { name: 'taken-developer', agents: 'custom agent' } as WorkerResponse);
    await expect(deployDevelopmentSquad('taken')).rejects.toThrow('已存在');
    expect(agentteamsApi.createSkill).not.toHaveBeenCalled();
    expect(agentteamsApi.updateWorker).not.toHaveBeenCalled();
    workers.clear(); team = { name: 'taken', leaderName: 'other', workerNames: ['other'] } as TeamResponse;
    await expect(deployDevelopmentSquad('taken')).rejects.toThrow('已存在');
  });

  it('does not treat permission or storage errors as missing assets', async () => {
    vi.mocked(agentteamsApi.getSkill).mockRejectedValue(new ApiError('denied', 403, '/skills'));
    await expect(deployDevelopmentSquad('denied')).rejects.toThrow('denied');
    expect(agentteamsApi.createSkill).not.toHaveBeenCalled();
    expect(agentteamsApi.createWorker).not.toHaveBeenCalled();
  });

  it('keeps other skill associations when completing a partial deployment', async () => {
    const role = DEVELOPMENT_ROLES[0];
    workers.set('merge-leader', { name: 'merge-leader', agents: deploymentAgents('merge', role), skills: ['existing-skill'], state: 'Stopped', runtime: 'openclaw' } as WorkerResponse);
    await deployDevelopmentSquad('merge');
    expect(workers.get('merge-leader')?.skills).toEqual(['existing-skill', role.skillName]);
  });

  it('recovers a concurrent team creation through the supported team list API', async () => {
    vi.mocked(agentteamsApi.createTeam).mockImplementationOnce(async data => {
      team = { name: data.name, leaderName: data.leader!.name, workerNames: data.workerNames } as TeamResponse;
      throw new ApiError('already exists', 409, '/teams');
    });
    await expect(deployDevelopmentSquad('race')).resolves.toMatchObject({ teamName: 'race' });
    expect(agentteamsApi.listTeams).toHaveBeenCalledTimes(2);
    expect([...workers.values()].every(worker => worker.state === 'Running')).toBe(true);
  });
});
