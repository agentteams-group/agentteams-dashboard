'use client';

import { OverflowText } from '@/components/dashboard/overflow-text';
import { teamHumanMembers } from '@/lib/agentteams-api';
import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import { TeamStatusSummary } from '../teams/team-status-summary';
import { ResourceIdentity } from './resource-summary-card';

/**
 * 团队只读详情主体（唯一实现，共享）：「这个团队是什么」——
 * 身份徽标 + 描述 + 所属人/成员/策略字段 + 运行状态块（TeamStatusSummary，
 * 与 TeamSettingsPanel 基本信息 tab、Inspector 头部同一实现）。
 *
 * 承载方：团队卡「详情」的只读弹窗（TeamDetailReadonlyDialog）。
 * 可编辑面永远在「编辑」（TeamDetailDialog / TeamSettingsPanel），两者不混用。
 */
export function TeamDetailSummary({
  team,
  workers,
}: {
  team: TeamResponse;
  workers: WorkerResponse[];
}) {
  const admin = team.admin?.name;
  const members = teamHumanMembers(team)
    .map((member) => member.name)
    .filter((name) => Boolean(name) && name !== admin);
  const workerCount = team.workerNames.length || team.totalWorkers;
  const facts: Array<[string, string]> = [
    ['团队名称', team.teamName || team.name],
    ['团队标识', team.name],
    ['所属人', admin || '未设置'],
    ['普通成员', members.length ? members.join('、') : '暂无普通成员'],
    ['Leader', team.leaderName || '未设置'],
    ['智能体', `${workerCount} 个`],
    ['空闲超时', team.workerIdleTimeout || '-'],
    ['心跳间隔', team.heartbeatEvery || team.leaderHeartbeat?.every || '-'],
    ['子代理默认模型', team.subagentModel || '继承各智能体主模型'],
  ];
  return (
    <div className="min-w-0 space-y-3 py-2 text-sm">
      <ResourceIdentity
        name={team.teamName || team.name}
        role={`团队 · ${members.length + (admin ? 1 : 0)} 人 · ${workerCount} 智能体`}
        kind="team"
        phase={team.phase}
      />
      <OverflowText
        text={team.description || '未填写描述'}
        multiline
        className="text-xs leading-5 text-muted-foreground"
      />
      <dl className="space-y-1">
        {facts.map(([label, value]) => (
          <div
            key={label}
            className="flex min-w-0 items-baseline justify-between gap-3 border-b border-border/50 py-1"
          >
            <dt className="shrink-0 whitespace-nowrap text-muted-foreground">{label}</dt>
            <dd className="min-w-0 break-all text-right font-mono text-xs">{value}</dd>
          </div>
        ))}
      </dl>
      <TeamStatusSummary team={team} workers={workers} />
      {team.message ? (
        <p className="text-xs text-muted-foreground">{team.message}</p>
      ) : null}
    </div>
  );
}
