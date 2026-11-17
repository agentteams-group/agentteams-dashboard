'use client';

import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { TeamSettingsPanel } from '../teams/team-settings-panel';
import { DetailDialogShell } from './detail-dialog-shell';

/**
 * 团队详情大弹窗：承载当前 main 版 TeamSettingsPanel（只按现有签名嵌入，
 * 不改面板内部行为）。面板自带滚动链（内部 min-h-0 flex-1 overflow-y-auto），
 * 所以 body 用 flex 定高 + overflow-hidden。
 */
export function TeamDetailDialog({
  open,
  onOpenChange,
  team,
  allTeams,
  workers,
  modelOptions,
  sessionIssue,
  userLevel,
  onChanged,
  onDeleted,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  team: TeamResponse | null;
  allTeams?: TeamResponse[];
  workers: WorkerResponse[];
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  userLevel: number;
  onChanged?: () => void;
  /** 面板内删除团队成功后：关弹窗并清选中。 */
  onDeleted?: () => void;
}) {
  if (!team) return null;
  return (
    <DetailDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={`团队设置 · ${team.name}`}
      description="团队基本信息、LLM 调参与成员管理"
      bodyClassName="flex flex-col overflow-hidden"
    >
      {/* 按 team.name key 重挂载：切队重建草稿、同队草稿不丢（面板契约）。 */}
      <TeamSettingsPanel
        key={team.name}
        team={team}
        allTeams={allTeams}
        workers={workers}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        userLevel={userLevel}
        onChanged={onChanged}
        onDeleted={onDeleted}
      />
    </DetailDialogShell>
  );
}
