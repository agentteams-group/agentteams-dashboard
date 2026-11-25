import type { WorkflowPayload } from '@/lib/a2ui/workflow';
import type { RuntimeConfirmationBlock, RuntimeReviewReportBlock } from '@/lib/a2ui/protocol';

/**
 * 示例空间的接力卡数据（Workflow Relay Card）。
 * 模拟 Planner -> Coder -> Reviewer 的多 Agent 流转。
 */
export const DEMO_WORKFLOW_PAYLOAD: WorkflowPayload = {
  id: 'wf-demo-checkout-001',
  name: '多 Agent 协同：订单支付回路改造',
  status: 'in_progress',
  current_step_id: 'step-review',
  current_step_index: 2,
  items: [
    {
      id: 'step-plan',
      name: '架构拆解与契约设计',
      title: '架构拆解与契约设计',
      status: 'completed',
      worker: 'architect_agent',
      result_summary: '已完成数据结构定义与向下兼容策略制定',
    },
    {
      id: 'step-code',
      name: '核心支付状态机实现',
      title: '核心支付状态机实现',
      status: 'completed',
      worker: 'coder_agent',
      result_summary: '新增幂等令牌与防重入单元测试 12 条全部通过',
    },
    {
      id: 'step-review',
      name: '自动化审查与安全合规核验',
      title: '自动化审查与安全合规核验',
      status: 'in_progress',
      worker: 'security_reviewer',
    },
    {
      id: 'step-deploy',
      name: '生产环境金丝雀发布',
      title: '生产环境金丝雀发布',
      status: 'waiting',
      worker: 'devops_agent',
    },
  ],
};

/**
 * 示例空间的审查报告卡数据（Review Report Card）。
 */
export const DEMO_REVIEW_PAYLOAD: RuntimeReviewReportBlock['payload'] = {
  verdict: 'pass',
  summary: '代码规范核验通过，未发现高危漏洞；发现 1 处建议优化的数据库索引提示。',
  round: 1,
  project_id: 'task-checkout-flow',
  issues: [
    {
      id: 'issue-01',
      severity: 'suggestion',
      anchor: 'migrations/003_orders.sql:42',
      repro: '建议针对 (user_id, created_at) 建立复合索引以提升查询性能',
      owner_node: 'step-code',
    },
  ],
};

/**
 * 示例空间的人工干预卡数据（HITL Intervention Card）。
 */
export const DEMO_INTERVENTION_PAYLOAD: RuntimeConfirmationBlock['payload'] = {
  confirmation_id: 'conf-demo-db-migrate-01',
  tool_name: 'apply_database_migration',
  question: '即将向生产库执行变更操作：订单状态枚举扩展。是否确认放行？',
  options: [
    { id: 'approve', label: '确认执行迁移 (Approve)', recommended: true },
    { id: 'backup_first', label: '先备份数据快照 (Backup First)' },
    { id: 'reject', label: '拒绝此次操作 (Reject)' },
  ],
  multi_select: false,
};
