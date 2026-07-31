// Insights Engine for Overview Dashboard
// Automatically detects anomalies and generates actionable insights

import type { WorkerResponse, TeamResponse, ManagerResponse, InfrastructureInfo } from '@/lib/agentteams-api';

export interface Insight {
  id: string;
  severity: 'info' | 'warning' | 'critical';
  category: 'health' | 'capacity' | 'configuration' | 'connectivity';
  message: string;
  detail?: string;
  actionSection?: string; // section ID to navigate to
}

export function computeInsights(
  workers: WorkerResponse[] | undefined,
  teams: TeamResponse[] | undefined,
  managers: ManagerResponse[] | undefined,
  infrastructure: InfrastructureInfo | undefined,
  isConnected: boolean
): Insight[] {
  const insights: Insight[] = [];

  // Connection
  if (!isConnected) {
    insights.push({
      id: 'disconnected',
      severity: 'critical',
      category: 'connectivity',
      message: 'Controller 未连接',
      detail: '无法连接到 AgentTeams Controller，请检查网络和配置',
    });
  }

  if (!workers) return insights;

  // Failed workers
  const failedWorkers = workers.filter((w) => w.phase === 'Failed');
  if (failedWorkers.length > 0) {
    insights.push({
      id: 'failed-workers',
      severity: 'critical',
      category: 'health',
      message: `${failedWorkers.length} 个 Worker 处于失败状态`,
      detail: failedWorkers.map((w) => w.name).join(', '),
      actionSection: 'workers',
    });
  }

  // Pending workers (stuck)
  const pendingWorkers = workers.filter((w) => w.phase === 'Pending');
  if (pendingWorkers.length > 2) {
    insights.push({
      id: 'stuck-pending',
      severity: 'warning',
      category: 'health',
      message: `${pendingWorkers.length} 个 Worker 长时间处于 Pending`,
      detail: pendingWorkers.map((w) => w.name).join(', '),
      actionSection: 'workers',
    });
  }

  // Workers without teams
  const unassignedWorkers = workers.filter((w) => !w.team);
  if (unassignedWorkers.length > 0) {
    insights.push({
      id: 'unassigned-workers',
      severity: 'info',
      category: 'configuration',
      message: `${unassignedWorkers.length} 个 Worker 未分配团队`,
      detail: unassignedWorkers.map((w) => w.name).join(', '),
      actionSection: 'teams',
    });
  }

  // Workers without model
  const noModelWorkers = workers.filter((w) => !w.model);
  if (noModelWorkers.length > 0) {
    insights.push({
      id: 'no-model-workers',
      severity: 'warning',
      category: 'configuration',
      message: `${noModelWorkers.length} 个 Worker 未配置模型`,
      detail: noModelWorkers.map((w) => w.name).join(', '),
      actionSection: 'workers',
    });
  }

  // Worker health score analysis
  const HEALTH_PHASE_SCORES: Record<string, number> = { Running: 100, Ready: 100, Sleeping: 70, Pending: 40, Updating: 50, Stopped: 20, Failed: 0 };
  let totalScore = 0;
  const unhealthyWorkers: string[] = [];

  workers.forEach((w) => {
    const phaseScore = HEALTH_PHASE_SCORES[w.phase] || 50;
    totalScore += phaseScore;
    if (phaseScore < 40) {
      unhealthyWorkers.push(w.name);
    }
  });

  const avgHealth = Math.round(totalScore / workers.length);

  // Low overall health
  if (avgHealth < 50) {
    insights.push({
      id: 'low-worker-health',
      severity: 'critical',
      category: 'health',
      message: `Worker 平均健康评分过低 (${avgHealth}/100)`,
      detail: `健康评分较低，建议检查 Worker 状态。异常 Worker: ${unhealthyWorkers.join(', ')}`,
      actionSection: 'workers',
    });
  } else if (avgHealth < 70) {
    insights.push({
      id: 'moderate-worker-health',
      severity: 'warning',
      category: 'health',
      message: `Worker 平均健康评分偏低 (${avgHealth}/100)`,
      detail: `部分 Worker 需要关注。`,
      actionSection: 'workers',
    });
  }

  // Container state issues
  const containerIssues = workers.filter((w) => {
    const state = w.containerState?.toLowerCase();
    return state === 'exited' || state === 'dead' || state === 'restarting';
  });
  if (containerIssues.length > 0) {
    insights.push({
      id: 'container-issues',
      severity: 'warning',
      category: 'health',
      message: `${containerIssues.length} 个 Worker 容器状态异常`,
      detail: containerIssues.map((w) => `${w.name} (${w.containerState})`).join(', '),
      actionSection: 'workers',
    });
  }

  // Workers without Matrix integration
  const noMatrixWorkers = workers.filter((w) => !w.matrixUserID || !w.roomID);
  if (noMatrixWorkers.length > 0) {
    insights.push({
      id: 'no-matrix-integration',
      severity: 'info',
      category: 'configuration',
      message: `${noMatrixWorkers.length} 个 Worker 未完成 Matrix 集成`,
      detail: noMatrixWorkers.map((w) => w.name).join(', '),
      actionSection: 'workers',
    });
  }

  // Runtime distribution risk - all eggs in one basket
  const runtimeDist: Record<string, number> = {};
  workers.forEach((w) => { runtimeDist[w.runtime] = (runtimeDist[w.runtime] || 0) + 1; });
  const runtimes = Object.keys(runtimeDist);
  if (runtimes.length === 1 && workers.length > 2) {
    insights.push({
      id: 'single-runtime-risk',
      severity: 'info',
      category: 'capacity',
      message: `所有 Worker 使用单一运行时 (${runtimes[0]})`,
      detail: '缺乏运行时多样性，建议使用多种运行时降低风险',
      actionSection: 'workers',
    });
  }

  // Teams analysis
  if (teams) {
    const degradedTeams = teams.filter((t) => t.phase === 'Degraded');
    if (degradedTeams.length > 0) {
      insights.push({
        id: 'degraded-teams',
        severity: 'warning',
        category: 'health',
        message: `${degradedTeams.length} 个团队处于降级状态`,
        detail: degradedTeams.map((t) => t.teamName || t.name).join(', '),
        actionSection: 'teams',
      });
    }

    const failedTeams = teams.filter((t) => t.phase === 'Failed');
    if (failedTeams.length > 0) {
      insights.push({
        id: 'failed-teams',
        severity: 'critical',
        category: 'health',
        message: `${failedTeams.length} 个团队处于失败状态`,
        detail: failedTeams.map((t) => t.teamName || t.name).join(', '),
        actionSection: 'teams',
      });
    }

    // Teams with low readiness
    const lowReadinessTeams = teams.filter(
      (t) => t.totalWorkers > 0 && t.readyWorkers / t.totalWorkers < 0.5
    );
    if (lowReadinessTeams.length > 0) {
      insights.push({
        id: 'low-readiness',
        severity: 'warning',
        category: 'capacity',
        message: `${lowReadinessTeams.length} 个团队就绪率低于 50%`,
        detail: lowReadinessTeams.map((t) => `${t.teamName || t.name} (${t.readyWorkers}/${t.totalWorkers})`).join(', '),
        actionSection: 'teams',
      });
    }
  }

  // Infrastructure
  if (infrastructure) {
    const unhealthyServices: string[] = [];
    if (infrastructure.minio && !infrastructure.minio.healthy) unhealthyServices.push('MinIO');
    if (infrastructure.higress?.gateway.state === 'unreachable') unhealthyServices.push('Higress Gateway');
    if (infrastructure.higress?.console.state === 'unreachable') unhealthyServices.push('Higress Console');
    if (infrastructure.matrix && !infrastructure.matrix.healthy) unhealthyServices.push('Matrix');
    if (infrastructure.kubernetes && !infrastructure.kubernetes.healthy) unhealthyServices.push('Kubernetes');

    if (unhealthyServices.length > 0) {
      insights.push({
        id: 'unhealthy-services',
        severity: 'warning',
        category: 'connectivity',
        message: `${unhealthyServices.length} 个基础设施服务异常`,
        detail: unhealthyServices.join(', '),
      });
    }
  }

  // All good
  if (insights.length === 0) {
    insights.push({
      id: 'all-good',
      severity: 'info',
      category: 'health',
      message: '所有系统运行正常',
    });
  }

  return insights;
}
