'use client';

import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { TeamSettingsPanel } from '../teams/team-settings-panel';
import { DetailDialogShell } from './detail-dialog-shell';

/**
 * 分区映射（弹窗标题 `<实体名> · <分区名>`，按钮文字 = 分区名）：
 * Inspector 的 6 个细粒度 panel id → TeamSettingsPanel 真实 tab + 分区标题
 * （team-skills → agents；llm / danger → basic）；未命中的 initialTab 回退 basic。
 */
const TEAM_PANELS: Record<string, { tab: string; title: string }> = {
  basic: { tab: 'basic', title: '基本信息' },
  users: { tab: 'users', title: '团队成员' },
  'team-skills': { tab: 'agents', title: '团队技能' },
  llm: { tab: 'basic', title: 'LLM 调优' },
  agents: { tab: 'agents', title: '智能体管理' },
  danger: { tab: 'basic', title: '危险区' },
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
  /** 初始分区（Inspector 6 个 panel id；basic/users/agents 同值兼容）；A3 Inspector 分区直达。 */
  initialTab?: string;
  chrome?: 'full' | 'section';
}) {
  if (!team) return null;
  const panel = TEAM_PANELS[initialTab ?? 'basic'] ?? TEAM_PANELS.basic;
  return (
    <DetailDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={`${team.name} · ${panel.title}`}
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
        initialTab={panel.tab}
      />
    </DetailDialogShell>
  );
}
