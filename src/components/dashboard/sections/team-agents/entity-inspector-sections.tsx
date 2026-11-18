'use client';

import type { TeamResponse, WorkerResponse } from '@/lib/agentteams-api';
import type { ModelSelectionOption } from '@/lib/model-catalog';
import type { EntityInspectorEntity } from './entity-inspector';
import { ManagerDetailDialog } from './manager-detail-dialog';
import { TeamSectionDialog } from './team-section-dialog';
import { WorkerDetailDialog } from './worker-detail-dialog';

export interface EntitySectionDialogsProps {
  /** 当前实体（null = 全部关闭）。弹窗按 kind 路由到对应详情大弹窗。 */
  entity: EntityInspectorEntity | null;
  /** 分区弹窗开关。 */
  open: boolean;
  /** 直达分区 id（Inspector 分区按钮 / 深链 ?panel=）；缺省落面板默认分区。 */
  initialTab?: string | null;
  /** 弹窗形态：'section' 分区直出 / 'full' 整面板（单栏）。 */
  chrome: 'full' | 'section';
  modelOptions: ModelSelectionOption[];
  sessionIssue?: string | null;
  userLevel: number;
  /** 团队弹窗的成员 / 管理员候选（仅 team 实体用）。 */
  allTeams?: TeamResponse[];
  /** 团队弹窗的 Worker 列表（成员健康 / 计数口径）。 */
  workers: WorkerResponse[];
  onOpenChange: (_open: boolean) => void;
  onChanged?: () => void;
  onDeleted?: () => void;
}

/**
 * Inspector「分区按钮 → 详情大弹窗」的共享接线（单一实现）：
 * 工作台（triple 右栏 / dual 抽屉 / single 钻取）与卡片编辑抽屉
 * （WorkerDrawer）共用，按 entity.kind 路由到
 * TeamDetailDialog / WorkerDetailDialog / ManagerDetailDialog——
 * 与工作台 section 弹窗映射完全一致。
 * 三个弹窗互斥（同一时刻只有一个 entity kind），open 与 kind 同时满足才开。
 */
export function EntitySectionDialogs({
  entity,
  open,
  initialTab,
  chrome,
  modelOptions,
  sessionIssue,
  userLevel,
  allTeams,
  workers,
  onOpenChange,
  onChanged,
  onDeleted,
}: EntitySectionDialogsProps) {
  const team = entity?.kind === 'team' ? entity.team : null;
  const worker = entity?.kind === 'worker' ? entity.worker : null;
  const manager = entity?.kind === 'manager' ? entity.manager : null;
  return (
    <>
      <TeamSectionDialog
        open={open && entity?.kind === 'team'}
        onOpenChange={onOpenChange}
        team={team}
        allTeams={allTeams}
        workers={workers}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        userLevel={userLevel}
        onChanged={onChanged}
        onDeleted={onDeleted}
        initialTab={initialTab ?? undefined}
        chrome={chrome}
      />
      <WorkerDetailDialog
        open={open && entity?.kind === 'worker'}
        onOpenChange={onOpenChange}
        worker={worker}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        userLevel={userLevel}
        onChanged={onChanged}
        onDeleted={onDeleted}
        initialTab={initialTab ?? undefined}
        chrome={chrome}
      />
      <ManagerDetailDialog
        open={open && entity?.kind === 'manager'}
        onOpenChange={onOpenChange}
        manager={manager}
        modelOptions={modelOptions}
        sessionIssue={sessionIssue}
        userLevel={userLevel}
        onChanged={onChanged}
        initialTab={initialTab ?? undefined}
        chrome={chrome}
      />
    </>
  );
}
