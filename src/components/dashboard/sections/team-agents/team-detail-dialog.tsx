'use client';

import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { TeamSettingsPanel } from '../teams/team-settings-panel';
import { DetailDialogShell } from './detail-dialog-shell';

/**
 * 分区标题映射（弹窗标题 `<实体名> · <分区名>`）：与 TeamSettingsPanel 的
 * tab 同名同义；未命中的 initialTab 回退「基本信息」。
 */
const TEAM_SECTION_TITLES: Record<string, string> = {
  basic: '基本信息',
  users: '成员管理',
  agents: 'Agent 管理',
};

/**
 * 团队详情大弹窗（R1 分区直出）：以 chrome={chrome} 嵌入
 * TeamSettingsPanel —— 弹窗标题承担实体身份（`<实体名> · <分区名>`），
 * body 只渲染 initialTab 命中的分区；initialTab 缺失/无效时面板回退
 * 'full'（标题栏 + 横向 tab 列表，行为与旧版一致）。面板自带滚动链
 * （内部 min-h-0 flex-1 overflow-y-auto），body 用 flex 定高 + overflow-hidden。
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
  initialTab,
  chrome = 'section',
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
  /** 初始 tab（默认 basic，行为不变）；A3 Inspector 分区直达。 */
  initialTab?: string;
  chrome?: 'full' | 'section';
}) {
  if (!team) return null;
  const sectionTitle = TEAM_SECTION_TITLES[initialTab ?? 'basic'] ?? TEAM_SECTION_TITLES.basic;
  return (
    <DetailDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={`${team.name} · ${sectionTitle}`}
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
        chrome={chrome}
        initialTab={initialTab}
      />
    </DetailDialogShell>
  );
}
