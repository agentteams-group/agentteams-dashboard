import { agentteamsApi, type TeamResponse, type WorkerResponse } from './agentteams-api';
import { ApiError } from './api-error';
import { DEVELOPMENT_ROLES } from './development-squad-template';
export { DEVELOPMENT_ROLES } from './development-squad-template';

type DevelopmentRole = typeof DEVELOPMENT_ROLES[number];
export type SquadDeploymentStep = 'assets' | 'agents' | 'team' | 'starting';
export interface SquadDeploymentResult { teamName: string; workerNames: string[]; skillNames: string[] }

export function developmentSquadNameError(name: string): string | null {
  return /^[a-z](?:[a-z0-9-]{0,8}[a-z0-9])?$/.test(name)
    ? null : '使用 1–10 位小写字母、数字或连字符，以字母开头，以字母或数字结尾。';
}

function identity(name: string, role: DevelopmentRole): string {
  return `<!-- agentteams-development-squad:v1:${name}:${role.id} -->`;
}

export function deploymentAgents(name: string, role: DevelopmentRole): string {
  return `${identity(name, role)}\nYou are the ${role.id} in development squad ${name}.\nUse the ${role.skillName} skill for your assigned work.\nFollow the built-in AgentTeams team and task instructions; do not replace their protocol.\n`;
}

function assertOwned(worker: WorkerResponse, name: string, role: DevelopmentRole) {
  if (!worker.agents?.includes(identity(name, role))) {
    throw new Error(`Agent「${worker.name}」已存在，不能覆盖；请使用其他小队名称。`);
  }
}

function assertTeam(team: TeamResponse, names: string[]) {
  const members = new Set([team.leaderName, ...(team.workerNames ?? [])]);
  if (team.leaderName !== names[0] || members.size !== names.length || names.some(name => !members.has(name))) {
    throw new Error(`团队「${team.name}」已存在，成员与开发小队不一致；请使用其他名称。`);
  }
}

/** Reuses the authenticated asset, Worker and Team APIs, including their RBAC and audit checks. */
export async function deployDevelopmentSquad(
  name: string,
  progress: (_step: SquadDeploymentStep, _message: string) => void = () => {},
): Promise<SquadDeploymentResult> {
  const invalid = developmentSquadNameError(name);
  if (invalid) throw new Error(invalid);
  const names = DEVELOPMENT_ROLES.map(role => `${name}-${role.id}`);
  const [workers, teams] = await Promise.all([agentteamsApi.listWorkers(), agentteamsApi.listTeams()]);
  const existingWorkers = new Map(workers.map(worker => [worker.name, worker]));
  let team = teams.find(item => item.name === name);
  if (team) assertTeam(team, names);
  for (const [index, role] of DEVELOPMENT_ROLES.entries()) {
    const worker = existingWorkers.get(names[index]);
    if (worker) assertOwned(worker, name, role);
  }

  const packages: File[] = [];
  let templateSkills: Awaited<ReturnType<typeof agentteamsApi.getDevelopmentSquadSkills>> | undefined;
  progress('assets', '正在同步角色 Skill 到资产库');
  for (const role of DEVELOPMENT_ROLES) {
    try {
      await agentteamsApi.getSkill(role.skillName);
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
      const { zipSync, strToU8 } = await import('fflate');
      templateSkills ??= await agentteamsApi.getDevelopmentSquadSkills();
      const skill = templateSkills.skills.find(item => item.name === role.skillName);
      if (!skill) throw new Error(`官网模板缺少 Skill「${role.skillName}」`);
      const bytes = zipSync({ [`${role.skillName}/SKILL.md`]: strToU8(skill.content) });
      const created = await agentteamsApi.createSkill(new File([bytes as BlobPart], `${role.skillName}.zip`, { type: 'application/zip' }));
      if (!created.success && !created.conflict) throw new Error(`Skill「${role.skillName}」同步失败`);
    }
    // Always distribute the asset's canonical package, preserving edits made in the asset center.
    packages.push(await agentteamsApi.downloadSkill(role.skillName));
  }

  for (const [index, role] of DEVELOPMENT_ROLES.entries()) {
    const workerName = names[index];
    progress('agents', `正在配置${role.title}并关联 Skill`);
    if (!existingWorkers.has(workerName)) {
      try {
        await agentteamsApi.createWorker({
          name: workerName, runtime: 'openclaw', state: 'Stopped',
          agents: deploymentAgents(name, role), skills: [role.skillName],
        });
      } catch (error) {
        if (!(error instanceof ApiError) || error.status !== 409) throw error;
        assertOwned(await agentteamsApi.getWorker(workerName), name, role);
      }
    }
    const uploaded = await agentteamsApi.uploadWorkerSkill(workerName, packages[index], 'openclaw', { restart: false });
    if (!uploaded.success || uploaded.skillName !== role.skillName) throw new Error(`Agent「${workerName}」的 Skill 分发未确认`);
    const latest = await agentteamsApi.getWorker(workerName);
    const skills = latest.skills ?? [];
    if (!skills.includes(role.skillName)) await agentteamsApi.updateWorker(workerName, { skills: [...skills, role.skillName] });
  }

  progress('team', '正在建立小队及 Leader 关联');
  if (!team) {
    try {
      team = await agentteamsApi.createTeam({
        name, teamName: '开发小队', description: '开发、代码评审和测试协作交付，由 Leader 统一派发和验收。',
        leader: { name: names[0] }, workerNames: names,
      });
    } catch (error) {
      if (!(error instanceof ApiError) || error.status !== 409) throw error;
      team = (await agentteamsApi.listTeams()).find(item => item.name === name);
      if (!team) throw error;
      assertTeam(team, names);
    }
  }
  progress('starting', '配置已完成，正在启动 Agent');
  for (const workerName of names) {
    const worker = await agentteamsApi.getWorker(workerName);
    if (worker.state !== 'Running') await agentteamsApi.updateWorker(workerName, { state: 'Running' });
  }
  return { teamName: name, workerNames: names, skillNames: DEVELOPMENT_ROLES.map(role => role.skillName) };
}
