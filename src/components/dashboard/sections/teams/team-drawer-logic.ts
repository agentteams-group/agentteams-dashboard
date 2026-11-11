// 团队设置抽屉的纯计算层（无 React / 无 IO，单测直接覆盖）。
//
// 语义对齐工作台插件「配置团队」：
//   · 团队成员 = workerMembers 全量替换（leader 角色唯一）；
//   · 行模型 / 批量模型 = 写入 Worker 的 PUT（只发改动行）；
//   · 团队级 LLM 调优 = 与基本信息同一次 team PUT，字段级 diff；
//   · 技能分配 = PUT /workers {skills}（整字段替换），独立于团队保存。

import type { TeamResponse, UpdateTeamRequest, WorkerResponse } from '@/lib/agentteams-api';
import { diffLlmTuning, pickLlmTuning, type LlmTuningRecord } from '@/lib/llm-tuning';

export type TeamMemberRole = 'team_leader' | 'worker';

export interface TeamMemberRow {
  name: string;
  role: TeamMemberRole;
  model: string;
  /** 服务端现值（行内弹窗直写成功后同步，用于「只发改动行」判定）。 */
  baseModel: string;
  /** 服务端现值 modelProvider（列表投影可能缺省；保存模型时非空才随写，与插件一致）。 */
  baseProvider?: string;
  missing: boolean;
}

export interface TeamBasicDraft {
  teamName: string;
  description: string;
  workerIdleTimeout: string;
  peerMentions?: boolean;
  /** 心跳间隔（如 "10m"）；留空 = 清空回 Controller 默认。 */
  heartbeatEvery: string;
  /** 子代理默认模型；留空 = 继承各 Worker 主模型。 */
  subagentModel: string;
}

/** 团队 + 在服 Worker 列表 → 成员行（Leader 在前，缺失引用标红）。 */
export function buildMemberRows(
  team: TeamResponse,
  workers: WorkerResponse[],
): TeamMemberRow[] {
  const byName = new Map(workers.map((worker) => [worker.name, worker]));
  const rows: TeamMemberRow[] = [];
  const push = (name: string, role: TeamMemberRole) => {
    const worker = byName.get(name);
    const model = worker?.model ?? '';
    rows.push({
      name,
      role,
      model,
      baseModel: model,
      baseProvider: worker?.modelProvider,
      missing: !worker,
    });
  };
  if (team.leaderName) push(team.leaderName, 'team_leader');
  for (const name of team.workerNames ?? []) {
    if (name && name !== team.leaderName) push(name, 'worker');
  }
  return rows;
}

export function missingMemberNames(rows: TeamMemberRow[]): string[] {
  return rows.filter((row) => row.missing).map((row) => row.name);
}

/** 批量画笔：只刷指定角色的行（留空 = 不改）。 */
export function applyBatchModel(
  rows: TeamMemberRow[],
  role: TeamMemberRole,
  model: string,
): TeamMemberRow[] {
  const next = model.trim();
  if (!next) return rows;
  return rows.map((row) => (row.role === role ? { ...row, model: next } : row));
}

/**
 * 只收集「有值且与基线不同」的行——空值 = 不改。
 * 携带服务端现值 modelProvider：写模型时非空才随写（与插件
 * doCfg 的 {model, modelProvider} 同语义；空 provider 永不发送）。
 */
export function changedMemberModels(
  rows: TeamMemberRow[],
): Array<{ name: string; model: string; modelProvider?: string }> {
  return rows
    .filter((row) => row.model.trim() && row.model.trim() !== row.baseModel.trim())
    .map((row) => ({
      name: row.name,
      model: row.model.trim(),
      modelProvider: row.baseProvider?.trim() ? row.baseProvider.trim() : undefined,
    }));
}

/** workerMembers 全量替换载荷：Leader 单独给，workerNames 去重且排除 Leader。 */
export function buildMemberUpdate(rows: TeamMemberRow[]): {
  leader: { name: string } | null;
  workerNames: string[];
} {
  const leaderRow = rows.find((row) => row.role === 'team_leader');
  const seen = new Set<string>();
  const workerNames: string[] = [];
  for (const row of rows) {
    const name = row.name.trim();
    if (!name || seen.has(name) || row.role !== 'worker') continue;
    seen.add(name);
    workerNames.push(name);
  }
  return {
    leader: leaderRow && leaderRow.name.trim() ? { name: leaderRow.name.trim() } : null,
    workerNames,
  };
}

export function buildBasicDraft(team: TeamResponse): TeamBasicDraft {
  return {
    teamName: team.teamName || '',
    description: team.description || '',
    workerIdleTimeout: team.workerIdleTimeout || '',
    peerMentions: typeof team.peerMentions === 'boolean' ? team.peerMentions : undefined,
    heartbeatEvery: team.heartbeatEvery || '',
    subagentModel: team.subagentModel || '',
  };
}

/** 基本信息 + 团队 LLM 调优 → PUT diff（未改字段不发；描述/空闲超时清空也发）。 */
export function buildBasicUpdate(
  team: TeamResponse,
  draft: TeamBasicDraft,
  llmDraft: LlmTuningRecord,
): UpdateTeamRequest {
  const data: UpdateTeamRequest = {};
  const teamName = draft.teamName.trim();
  if (teamName && teamName !== (team.teamName || '')) data.teamName = teamName;
  if (draft.description !== (team.description || '')) data.description = draft.description;
  const idle = draft.workerIdleTimeout.trim();
  if (idle !== (team.workerIdleTimeout || '').trim()) data.workerIdleTimeout = idle;
  if (
    typeof team.peerMentions === 'boolean' &&
    typeof draft.peerMentions === 'boolean' &&
    draft.peerMentions !== team.peerMentions
  ) {
    data.peerMentions = draft.peerMentions;
  }
  // 心跳间隔 / 子代理默认模型：与插件 doCfg 同语义——trim 后发送，留空 = null（清空）。
  const heartbeat = draft.heartbeatEvery.trim();
  if (heartbeat !== (team.heartbeatEvery || '').trim()) data.heartbeatEvery = heartbeat || null;
  const subagent = draft.subagentModel.trim();
  if (subagent !== (team.subagentModel || '').trim()) data.subagentModel = subagent || null;
  return { ...data, ...diffLlmTuning(pickLlmTuning(team), llmDraft) };
}

/** 未归属任何团队的 Worker（团队引用集按 leaderName + workerNames 计）。 */
export function standaloneWorkers(
  teams: TeamResponse[] | undefined,
  workers: WorkerResponse[] | undefined,
): WorkerResponse[] {
  const referenced = new Set<string>();
  for (const team of teams ?? []) {
    if (team.leaderName) referenced.add(team.leaderName);
    for (const name of team.workerNames ?? []) referenced.add(name);
  }
  return (workers ?? []).filter((worker) => !referenced.has(worker.name));
}

/** 并入未归属 Worker：保留原成员，仅追加。 */
export function mergeMember(rows: TeamMemberRow[], worker: WorkerResponse): TeamMemberRow[] {
  if (rows.some((row) => row.name === worker.name)) return rows;
  return [
    ...rows,
    {
      name: worker.name,
      role: 'worker',
      model: worker.model || '',
      baseModel: worker.model || '',
      baseProvider: worker.modelProvider,
      missing: false,
    },
  ];
}

export type SkillMatrix = Record<string, string[]>;

export function skillBaseline(workers: WorkerResponse[]): SkillMatrix {
  const baseline: SkillMatrix = {};
  for (const worker of workers) baseline[worker.name] = [...(worker.skills ?? [])];
  return baseline;
}

/** 草稿优先、未触碰的行走服务端基线。 */
export function skillValuesFor(draft: SkillMatrix, baseline: SkillMatrix, name: string): string[] {
  return draft[name] ?? baseline[name] ?? [];
}

/** 矩阵列 = 目录 ∪ 各成员已分配（目录里被删的残留也要能看见）。 */
export function skillColumns(catalogNames: string[], draft: SkillMatrix, baseline: SkillMatrix): string[] {
  const all = new Set<string>(catalogNames);
  for (const name of Object.keys(baseline)) {
    for (const skill of baseline[name]) all.add(skill);
  }
  for (const name of Object.keys(draft)) {
    for (const skill of draft[name]) all.add(skill);
  }
  return [...all].sort((a, b) => a.localeCompare(b));
}

/** 只输出真正改动的行（集合比较，顺序无关）。 */
export function diffSkillAssignments(
  baseline: SkillMatrix,
  draft: SkillMatrix,
): Array<{ name: string; skills: string[] }> {
  const changes: Array<{ name: string; skills: string[] }> = [];
  for (const [name, skills] of Object.entries(draft)) {
    const before = baseline[name] ?? [];
    const next = [...new Set(skills)].sort();
    const prev = [...new Set(before)].sort();
    if (next.length === prev.length && next.every((skill, index) => skill === prev[index])) continue;
    changes.push({ name, skills });
  }
  return changes;
}
