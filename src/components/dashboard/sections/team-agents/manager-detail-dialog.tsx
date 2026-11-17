'use client';

import type { ManagerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { ManagerDetailPanel } from '../managers/manager-detail-panel';
import { DetailDialogShell } from './detail-dialog-shell';

/**
 * 分区标题映射（弹窗标题 `<实体名> · <分区名>`）：与 ManagerDetailPanel /
 * Inspector 分区列表同名同义；未命中的 initialTab 回退「基本信息」。
 */
const MANAGER_SECTION_TITLES: Record<string, string> = {
  basic: '基本信息',
  model: '模型',
  prompts: '提示词',
  skills: '技能',
  mcp: 'MCP',
  env: '环境变量',
  config: '运行参数',
  logs: '日志',
};

/**
 * Manager 详情大弹窗（R1 分区直出）：以 chrome="section" 嵌入
 * ManagerDetailPanel —— 弹窗标题承担实体身份（`<实体名> · <分区名>`），
 * body 只渲染 initialTab 命中的分区内容；initialTab 缺失/无效时面板回退
 * 'full'（身份头 + 动作条 + 垂直 tab 列表，行为与旧版一致）。
 * body 用 flex 定高 + overflow-hidden，分区内容由面板内部自滚。
 * 编辑入口（onEdit）沿用 #233 口径：工作台不传，Manager 列表页
 * （managers-section）自带编辑抽屉。
 */
export function ManagerDetailDialog({
  open,
  onOpenChange,
  manager,
  modelOptions,
  sessionIssue,
  userLevel,
  onDm,
  onChanged,
  initialTab,
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  manager: ManagerResponse | null;
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  userLevel: number;
  onDm?: (_mxid: string, _roomId?: string) => void;
  onChanged?: () => void;
  /** 初始 tab（默认 basic，行为不变）；A3 Inspector 分区直达。 */
  initialTab?: string;
}) {
  if (!manager) return null;
  const sectionTitle = MANAGER_SECTION_TITLES[initialTab ?? 'basic'] ?? MANAGER_SECTION_TITLES.basic;
  return (
    <DetailDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={`${manager.name} · ${sectionTitle}`}
      description="Manager 运行状态与配置详情"
      bodyClassName="flex flex-col overflow-hidden"
    >
      <ManagerDetailPanel
        key={manager.name}
        manager={manager}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        userLevel={userLevel}
        onDm={onDm}
        className="min-h-0 flex-1"
        chrome="section"
        onChanged={onChanged}
        initialTab={initialTab}
      />
    </DetailDialogShell>
  );
}
