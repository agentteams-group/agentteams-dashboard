'use client';

import type { WorkerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import { WorkerDetailPanel } from '../workers/worker-detail-panel';
import { DetailDialogShell } from './detail-dialog-shell';

/**
 * 分区标题映射（弹窗标题 `<实体名> · <分区名>`）：与面板 detailTabs /
 * Inspector 分区列表同名同义；未命中的 initialTab 回退「基础配置」。
 */
const WORKER_SECTION_TITLES: Record<string, string> = {
  basic: '基础配置',
  mcp: 'MCP',
  skills: '技能',
  runtime: '高级配置',
  'workspace-files': '工作区文件',
  chats: '会话',
  tools: '工具',
  channels: '频道',
  approval: '审批模式',
  'coding-cli': 'Coding CLI',
  plugins: 'Worker 插件',
  upgrade: '运行时升级',
  checkpoints: '检查点',
};

/**
 * Agent 详情大弹窗（R1 分区直出）：以 chrome={chrome} 嵌入
 * WorkerDetailPanel —— 弹窗标题承担实体身份（`<实体名> · <分区名>`），
 * body 只渲染 initialTab 命中的分区内容；initialTab 缺失/无效时面板回退
 * 'full'（完整头部 + 动作条 + 垂直 tab 列表，行为与旧版一致）。
 * body 用 flex 定高 + overflow-hidden，分区内容由面板内部自滚。
 */
export function WorkerDetailDialog({
  open,
  onOpenChange,
  worker,
  modelOptions,
  sessionIssue,
  userLevel,
  onDm,
  onChanged,
  onDeleted,
  initialTab,
  chrome = 'section',
}: {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  worker: WorkerResponse | null;
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  userLevel: number;
  onDm?: (_mxid: string, _roomId?: string) => void;
  onChanged?: () => void;
  /** 面板内删除 Worker 成功后：关弹窗并清选中。 */
  onDeleted?: () => void;
  /** 初始 tab（默认 basic，行为不变）；A3 Inspector 分区直达。 */
  initialTab?: string;
  chrome?: 'full' | 'section';
}) {
  if (!worker) return null;
  const sectionTitle = WORKER_SECTION_TITLES[initialTab ?? 'basic'] ?? WORKER_SECTION_TITLES.basic;
  return (
    <DetailDialogShell
      open={open}
      onOpenChange={onOpenChange}
      title={`${worker.name} · ${sectionTitle}`}
      description="智能体运行状态与配置详情"
      bodyClassName="flex flex-col overflow-hidden"
    >
      <WorkerDetailPanel
        key={worker.name}
        worker={worker}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        userLevel={userLevel}
        onClose={() => onOpenChange(false)}
        onDm={onDm}
        className="min-h-0 flex-1"
        chrome={chrome}
        onChanged={onChanged}
        onDeleted={onDeleted}
        initialTab={initialTab}
      />
    </DetailDialogShell>
  );
}
