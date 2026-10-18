/**
 * Artifact three-state model (PRD F1.3 / §7.2).
 *
 * 状态机：draft → pending_review → released（released 可被撤销生成新记录）。
 * M1 数据面：上游任务归一化状态（pending/delegated/in-progress/completed/
 * revision/blocked，PRD §7.2 引用前端口径）+ result_status。放行记录载体
 * （com.agentteams.release 房间状态事件）由 M2 F3.3 落地，M1 的 released
 * 判定只能依据任务完成态 → 带降级说明，UI 徽标 tooltip 透明呈现。
 */

export type ArtifactState = 'draft' | 'pending_review' | 'released';

export interface ArtifactStateInfo {
  state: ArtifactState;
  /** 降级/依据说明：非空时 UI 必须展示（PRD §7.4 降级可见）。 */
  note?: string;
}

/** 上游 result_status（Outcome 口径）里代表"要返工"的取值。 */
const REWORK_OUTCOMES = new Set(['REVISION_NEEDED', 'BLOCKED']);

const COMPLETE_TASK_STATUSES = new Set(['completed', 'success', 'done']);

/**
 * 从任务状态推导其交付物的工件态。
 *
 * - completed（且 result_status 非返工）→ released，附 M1 降级说明
 *   （放行记录待 M2 审查闭环写入）；
 * - result_status 为 REVISION_NEEDED / BLOCKED → draft（需修订）；
 * - 其余（pending/delegated/in-progress/revision/未知）→ draft。
 * - pending_review 预留给 M2：runtime 发出审查请求（F2/F3 结构化块）后，
 *   「已提交待审」才有事实源；M1 不会返回该态。
 */
export function artifactStateFromTask(task: {
  status?: string;
  result_status?: string;
}): ArtifactStateInfo {
  const status = (task.status ?? '').toLowerCase();
  const outcome = (task.result_status ?? '').toUpperCase();

  if (COMPLETE_TASK_STATUSES.has(status) && !REWORK_OUTCOMES.has(outcome)) {
    return {
      state: 'released',
      note: '依据任务完成态判定；人工放行记录待审查闭环（M2）写入后以此为准',
    };
  }
  if (REWORK_OUTCOMES.has(outcome)) {
    return { state: 'draft', note: `验收结论 ${outcome}：需修订后重新提交` };
  }
  return { state: 'draft' };
}

export const ARTIFACT_STATE_LABELS: Record<ArtifactState, string> = {
  draft: '草稿',
  pending_review: '待审',
  released: '已放行',
};
