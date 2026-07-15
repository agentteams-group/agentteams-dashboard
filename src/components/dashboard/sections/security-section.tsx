'use client';

import { useMemo, useCallback } from 'react';
import { motion } from 'framer-motion';
import {
  Shield,
  Lock,
  Eye,
  Key,
  UserCheck,
  AlertTriangle,
  ArrowRight,
  Zap,
  CheckCircle2,
  XCircle,
  Wifi,
  WifiOff,
  Users,
  Bot,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { SectionHeader } from '@/components/dashboard/section-header';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useMatrixStore } from '@/lib/matrix-store';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useInfrastructure } from '@/hooks/use-agentteams-infrastructure';

import type { HumanResponse } from '@/lib/agentteams-api';

const permissionLevelMap: Record<number, { label: string; color: string; icon: typeof Shield }> = {
  3: { label: '管理员', color: 'bg-red-500/10 text-red-600 dark:text-red-400', icon: Shield },
  2: { label: '操作者', color: 'bg-amber-500/10 text-amber-600 dark:text-amber-400', icon: UserCheck },
  1: { label: '观察者', color: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400', icon: Eye },
};

function getPermissionInfo(level: number | undefined) {
  if (level === 3) return permissionLevelMap[3];
  if (level === 2) return permissionLevelMap[2];
  return permissionLevelMap[1];
}

function AccessMatrix({ humans, teams, workers }: {
  humans: HumanResponse[];
  teams: { name: string; workerNames: string[] }[];
  workers: { name: string }[];
}) {
  // Build access matrix: for each human, which teams/workers can they access
  const matrixData = useMemo(() => {
    return humans.map((human) => {
      const groupAllowFrom = human.groupAllowFrom;
      const accessibleTeams = human.accessibleTeams;
      const accessibleWorkers = human.accessibleWorkers;
      const permLevel = human.permissionLevel;

      // Determine accessible teams
      const canAccessAll = permLevel === 3 || (groupAllowFrom && groupAllowFrom.includes('*'));
      const accessibleTeamNames = canAccessAll
        ? teams.map((t) => t.name)
        : (accessibleTeams || []).filter((t) => teams.some((tt) => tt.name === t));

      // Determine accessible workers (from teams + direct access)
      const teamWorkers = canAccessAll
        ? workers.map((w) => w.name)
        : accessibleTeamNames.flatMap((teamName) => {
            const team = teams.find((t) => t.name === teamName);
            return team?.workerNames || [];
          });
      const directWorkers = (accessibleWorkers || []).filter((w) => workers.some((ww) => ww.name === w));
      const allAccessibleWorkers = [...new Set([...teamWorkers, ...directWorkers])];

      return {
        human,
        permLevel: permLevel || 1,
        canAccessAll,
        accessibleTeamNames,
        accessibleWorkers: allAccessibleWorkers,
      };
    });
  }, [humans, teams, workers]);

  if (humans.length === 0) {
    return (
      <div className="p-8 text-center">
        <Users className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">暂无人类用户数据，无法展示访问控制矩阵</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto custom-scrollbar">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border">
            <th className="text-left p-3 font-medium text-muted-foreground sticky left-0 bg-card min-w-[120px]">用户</th>
            <th className="text-left p-3 font-medium text-muted-foreground">权限等级</th>
            <th className="text-left p-3 font-medium text-muted-foreground">可访问团队</th>
            <th className="text-left p-3 font-medium text-muted-foreground">可访问 Workers</th>
            <th className="text-left p-3 font-medium text-muted-foreground">矩阵 ID</th>
            <th className="text-left p-3 font-medium text-muted-foreground">房间数</th>
          </tr>
        </thead>
        <tbody>
          {matrixData.map((row, i) => {
            const permInfo = getPermissionInfo(row.permLevel);
            const PermIcon = permInfo.icon;
            return (
              <motion.tr
                key={row.human.name}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: i * 0.05 }}
                className="border-b border-border/50 hover:bg-accent/30"
              >
                <td className="p-3 sticky left-0 bg-card">
                  <div className="flex items-center gap-2">
                    <PermIcon className={`w-4 h-4 ${row.permLevel === 3 ? 'text-red-500' : row.permLevel === 2 ? 'text-amber-500' : 'text-cyan-500'}`} />
                    <div>
                      <span className="font-medium text-sm">{row.human.displayName || row.human.name}</span>
                      <p className="text-[10px] text-muted-foreground font-mono">{row.human.name}</p>
                    </div>
                  </div>
                </td>
                <td className="p-3">
                  <Badge className={`text-[10px] ${permInfo.color}`} variant="secondary">
                    Level {row.permLevel} · {permInfo.label}
                  </Badge>
                </td>
                <td className="p-3">
                  {row.canAccessAll ? (
                    <Badge variant="outline" className="text-[10px] text-emerald-600">全部 ({teams.length})</Badge>
                  ) : row.accessibleTeamNames.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {row.accessibleTeamNames.slice(0, 3).map((t) => (
                        <Badge key={t} variant="outline" className="text-[10px]">{t}</Badge>
                      ))}
                      {row.accessibleTeamNames.length > 3 && (
                        <Badge variant="outline" className="text-[10px]">+{row.accessibleTeamNames.length - 3}</Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">无</span>
                  )}
                </td>
                <td className="p-3">
                  {row.canAccessAll ? (
                    <Badge variant="outline" className="text-[10px] text-emerald-600">全部 ({workers.length})</Badge>
                  ) : row.accessibleWorkers.length > 0 ? (
                    <div className="flex flex-wrap gap-1">
                      {row.accessibleWorkers.slice(0, 3).map((w) => (
                        <Badge key={w} variant="outline" className="text-[10px]">
                          <Bot className="w-2.5 h-2.5 mr-0.5 text-primary" />
                          {w}
                        </Badge>
                      ))}
                      {row.accessibleWorkers.length > 3 && (
                        <Badge variant="outline" className="text-[10px]">+{row.accessibleWorkers.length - 3}</Badge>
                      )}
                    </div>
                  ) : (
                    <span className="text-xs text-muted-foreground">无</span>
                  )}
                </td>
                <td className="p-3">
                  <span className="font-mono text-xs" title={row.human.matrixUserID}>
                    {row.human.matrixUserID ? row.human.matrixUserID.substring(0, 20) + (row.human.matrixUserID.length > 20 ? '...' : '') : '-'}
                  </span>
                </td>
                <td className="p-3">
                  <Badge variant="outline" className="text-[10px]">{row.human.rooms?.length || 0}</Badge>
                </td>
              </motion.tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SecuritySection() {
  const { data: humans, refetch: refetchHumans } = useHumans();
  const { data: workers } = useWorkers();
  const { data: teams } = useTeams();
  const { data: managers } = useManagers();
  const { data: infra } = useInfrastructure();
  const matrixStore = useMatrixStore();
  const { isConnected } = useAgentTeamsStore();

  const handleRefresh = useCallback(() => {
    refetchHumans();
  }, [refetchHumans]);

  // Dynamic permission levels from actual humans
  const permStats = useMemo(() => {
    const stats = { admin: 0, operator: 0, observer: 0 };
    humans?.forEach((h) => {
      const level = h.permissionLevel;
      if (level === 3) stats.admin++;
      else if (level === 2) stats.operator++;
      else stats.observer++;
    });
    return stats;
  }, [humans]);

  // Security checklist based on actual configuration
  const securityChecks = useMemo(() => {
    const checks: { label: string; checked: boolean; detail: string }[] = [];

    // Check: Matrix is available
    checks.push({
      label: 'Matrix 服务器已部署',
      checked: !!infra?.matrix?.healthy,
      detail: infra?.matrix?.healthy ? `Homeserver: ${infra.matrix.homeserver}` : 'Matrix 服务不可用',
    });

    // Check: Matrix dashboard login
    checks.push({
      label: 'Dashboard 已登录 Matrix',
      checked: matrixStore.isLoggedIn,
      detail: matrixStore.isLoggedIn ? `用户: ${matrixStore.userId}` : '未登录 Matrix 账户',
    });

    // Check: Higress gateway is healthy
    checks.push({
      label: 'Higress 网关正常运行',
      checked: !!infra?.higress?.healthy,
      detail: infra?.higress?.healthy ? `端点: ${infra.higress.endpoint}` : '网关不可用',
    });

    // Check: No humans with default/empty password (can't verify directly, so check if humans exist)
    checks.push({
      label: '人类用户已配置',
      checked: (humans?.length || 0) > 0,
      detail: humans?.length ? `${humans.length} 个用户已创建` : '尚未创建人类用户',
    });

    // Check: Workers are not all in failed state
    const failedWorkers = workers?.filter((w) => w.phase === 'Failed').length || 0;
    checks.push({
      label: '无失败的 Workers',
      checked: failedWorkers === 0,
      detail: failedWorkers > 0 ? `${failedWorkers} 个 Worker 处于失败状态` : '所有 Worker 状态正常',
    });

    // Check: Teams have workers assigned
    const emptyTeams = teams?.filter((t) => t.totalWorkers === 0).length || 0;
    checks.push({
      label: '所有团队已分配 Worker',
      checked: emptyTeams === 0,
      detail: emptyTeams > 0 ? `${emptyTeams} 个团队没有 Worker` : '所有团队均有 Worker',
    });

    // Check: Managers are running
    const failedManagers = managers?.filter((m) => m.phase === 'Failed').length || 0;
    checks.push({
      label: 'Manager 运行正常',
      checked: failedManagers === 0 && (managers?.length || 0) > 0,
      detail: failedManagers > 0 ? `${failedManagers} 个 Manager 失败` : managers?.length ? '所有 Manager 正常' : '未部署 Manager',
    });

    // Check: K8s is in cluster mode
    checks.push({
      label: 'Kubernetes 集群模式',
      checked: !!infra?.kubernetes?.healthy,
      detail: infra?.kubernetes?.healthy ? `版本: ${infra.kubernetes.version}` : '未运行在 K8s 集群模式',
    });

    // Check: Controller is connected
    checks.push({
      label: 'Controller 已连接',
      checked: isConnected,
      detail: isConnected ? '连接正常' : '未连接到 Controller',
    });

    return checks;
  }, [infra, matrixStore.isLoggedIn, matrixStore.userId, humans, workers, teams, managers, isConnected]);

  const checkedCount = securityChecks.filter((c) => c.checked).length;

  return (
    <div className="space-y-6">
      <SectionHeader
        title="安全模型"
        description="AgentTeams 安全架构、权限管理和合规检查"
        isLive={isConnected}
        onRefresh={handleRefresh}
      />

      {/* Security Pillars */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[
          {
            icon: Lock,
            title: '隔离运行',
            desc: '每个 Worker 运行在独立的容器中，资源隔离、网络隔离，防止横向攻击。',
            color: 'text-red-500',
          },
          {
            icon: Key,
            title: '权限分级',
            desc: `Human 用户分为 3 个权限等级：管理员(${permStats.admin})、操作者(${permStats.operator})、观察者(${permStats.observer})。`,
            color: 'text-amber-500',
          },
          {
            icon: Eye,
            title: '审计追踪',
            desc: '所有操作和通信通过 Matrix 协议记录，完整的审计日志和可追溯性。',
            color: 'text-cyan-500',
          },
          {
            icon: Shield,
            title: '网关安全',
            desc: 'Higress 网关提供 API 认证、限流、加密传输，Consumer 级别的访问控制。',
            color: 'text-emerald-500',
          },
          {
            icon: UserCheck,
            title: '身份验证',
            desc: '基于 Matrix 用户系统的身份验证，初始密码机制确保账户安全。',
            color: 'text-violet-500',
          },
          {
            icon: AlertTriangle,
            title: '安全策略',
            desc: 'Worker 状态管控（唤醒/休眠/停止），容器管理策略，防止未授权行为。',
            color: 'text-primary',
          },
        ].map((item, i) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.1 }}
          >
            <Card className="glass-card hover-lift">
              <CardContent className="p-4">
                <item.icon className={`w-8 h-8 ${item.color} mb-3`} />
                <h3 className="font-semibold mb-1">{item.title}</h3>
                <p className="text-sm text-muted-foreground">{item.desc}</p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Human Permission Levels - Dynamic from API */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Key className="w-4 h-4" />
            用户权限等级
            <Badge variant="outline" className="text-[10px] ml-auto">{humans?.length || 0} 用户</Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          {humans && humans.length > 0 ? (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {/* Level 3 - Admin */}
              <div className="p-3 rounded-lg bg-background/50 border border-border/50">
                <div className="flex items-center gap-2 mb-2">
                  <Shield className="w-4 h-4 text-red-500" />
                  <Badge className="bg-red-500/10 text-red-600 dark:text-red-400" variant="secondary">Level 3 · 管理员</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-2">可访问所有房间、所有智能体</p>
                <div className="space-y-1">
                  {humans.filter((h) => h.permissionLevel === 3).map((h) => (
                    <div key={h.name} className="flex items-center gap-1.5 text-xs">
                      <CheckCircle2 className="w-3 h-3 text-red-500" />
                      <span>{h.displayName || h.name}</span>
                    </div>
                  ))}
                  {permStats.admin === 0 && <p className="text-xs text-muted-foreground italic">无管理员用户</p>}
                </div>
              </div>
              {/* Level 2 - Operator */}
              <div className="p-3 rounded-lg bg-background/50 border border-border/50">
                <div className="flex items-center gap-2 mb-2">
                  <UserCheck className="w-4 h-4 text-amber-500" />
                  <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400" variant="secondary">Level 2 · 操作者</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-2">指定团队 + 独立 Workers</p>
                <div className="space-y-1">
                  {humans.filter((h) => h.permissionLevel === 2).map((h) => (
                    <div key={h.name} className="flex items-center gap-1.5 text-xs">
                      <CheckCircle2 className="w-3 h-3 text-amber-500" />
                      <span>{h.displayName || h.name}</span>
                    </div>
                  ))}
                  {permStats.operator === 0 && <p className="text-xs text-muted-foreground italic">无操作者用户</p>}
                </div>
              </div>
              {/* Level 1 - Observer */}
              <div className="p-3 rounded-lg bg-background/50 border border-border/50">
                <div className="flex items-center gap-2 mb-2">
                  <Eye className="w-4 h-4 text-cyan-500" />
                  <Badge className="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400" variant="secondary">Level 1 · 观察者</Badge>
                </div>
                <p className="text-xs text-muted-foreground mb-2">仅指定独立 Workers</p>
                <div className="space-y-1">
                  {humans.filter((h) => {
      const level = h.permissionLevel;
                    return !level || level === 1;
                  }).map((h) => (
                    <div key={h.name} className="flex items-center gap-1.5 text-xs">
                      <CheckCircle2 className="w-3 h-3 text-cyan-500" />
                      <span>{h.displayName || h.name}</span>
                    </div>
                  ))}
                  {permStats.observer === 0 && <p className="text-xs text-muted-foreground italic">无观察者用户</p>}
                </div>
              </div>
            </div>
          ) : (
            <div className="p-6 text-center">
              <Users className="w-8 h-8 text-muted-foreground mx-auto mb-2" />
              <p className="text-sm text-muted-foreground">暂无用户数据，请先创建 Human 用户</p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Visual Access Control Matrix */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Shield className="w-4 h-4" />
            访问控制矩阵
          </CardTitle>
        </CardHeader>
        <CardContent className="p-0">
          <AccessMatrix
            humans={humans || []}
            teams={(teams || []).map((t) => ({ name: t.name, workerNames: t.workerNames || [] }))}
            workers={(workers || []).map((w) => ({ name: w.name }))}
          />
        </CardContent>
      </Card>

      {/* Matrix Authentication Status */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <Lock className="w-4 h-4" />
            Matrix 认证状态
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Matrix Server Status */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
              {infra?.matrix?.healthy ? (
                <Wifi className="w-5 h-5 text-emerald-500" />
              ) : (
                <WifiOff className="w-5 h-5 text-red-500" />
              )}
              <div>
                <p className="text-sm font-medium">
                  {infra?.matrix?.healthy ? 'Matrix 服务器在线' : 'Matrix 服务器离线'}
                </p>
                {infra?.matrix?.homeserver && (
                  <p className="text-xs text-muted-foreground font-mono">{infra.matrix.homeserver}</p>
                )}
              </div>
            </div>
            {/* Dashboard Login Status */}
            <div className="flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
              {matrixStore.isLoggedIn ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-500" />
              ) : (
                <XCircle className="w-5 h-5 text-amber-500" />
              )}
              <div>
                <p className="text-sm font-medium">
                  {matrixStore.isLoggedIn ? 'Dashboard 已登录 Matrix' : 'Dashboard 未登录 Matrix'}
                </p>
                {matrixStore.isLoggedIn && matrixStore.userId && (
                  <p className="text-xs text-muted-foreground font-mono">{matrixStore.userId}</p>
                )}
              </div>
            </div>
          </div>
          {humans && humans.length > 0 && (
            <div className="mt-3 p-3 rounded-lg bg-muted/30">
              <p className="text-xs text-muted-foreground font-medium mb-2">用户 Matrix 状态</p>
              <div className="flex flex-wrap gap-2">
                {humans.map((h) => (
                  <div key={h.name} className="flex items-center gap-1.5 text-xs px-2 py-1 rounded-md bg-background/50 border border-border/30">
                    {h.matrixUserID ? (
                      <CheckCircle2 className="w-3 h-3 text-emerald-500" />
                    ) : (
                      <XCircle className="w-3 h-3 text-red-500" />
                    )}
                    <span>{h.displayName || h.name}</span>
                    {h.phase === 'Active' && <Badge className="text-[9px] bg-green-500/10 text-green-600" variant="secondary">活跃</Badge>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Credential Zero-Exposure Diagram */}
      <Card className="glass-card">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold mb-4">凭证零暴露</h2>
          <p className="text-sm text-muted-foreground mb-4">
            所有外部 API 凭证由 Higress 网关统一管理，Worker 无需直接持有 API Key，实现凭证零暴露。
          </p>
          <div className="flex items-center justify-center gap-2 py-4 flex-wrap text-sm">
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-primary/10 border border-primary/20">
              <AlertTriangle className="w-4 h-4 text-primary" />
              <span>Worker 请求</span>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-500/30 border-2">
              <Shield className="w-4 h-4 text-rose-500" />
              <span className="font-semibold">Higress 网关</span>
              <Badge variant="outline" className="text-[10px]">注入 API Key</Badge>
            </div>
            <ArrowRight className="w-4 h-4 text-muted-foreground" />
            <div className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <Zap className="w-4 h-4 text-blue-500" />
              <span>外部 LLM API</span>
            </div>
          </div>
          <div className="mt-4 p-3 rounded-lg bg-background/50">
            <p className="text-xs text-muted-foreground">
              <strong className="text-foreground">工作原理：</strong>
              Worker 发起请求时不携带 API Key，Higress 网关拦截请求后注入对应的 Consumer 凭证，
              然后转发到目标 API。Worker 容器内始终无法接触到真实 API Key，确保凭证安全。
            </p>
          </div>
        </CardContent>
      </Card>

      {/* groupAllowFrom Explanation */}
      <Card className="glass-card">
        <CardContent className="p-6">
          <h2 className="text-lg font-semibold mb-4">groupAllowFrom 访问控制</h2>
          <p className="text-sm text-muted-foreground mb-4">
            <code className="px-1.5 py-0.5 rounded bg-muted text-xs font-mono">groupAllowFrom</code>
            字段限制了 Human 用户可以访问的 Worker 组，实现最小权限原则。
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="p-3 rounded-lg bg-background/50">
              <Badge className="bg-red-500/10 text-red-600 dark:text-red-400 mb-2" variant="secondary">Admin</Badge>
              <p className="text-xs text-muted-foreground">
                <code className="font-mono">groupAllowFrom: [&quot;*&quot;]</code>
              </p>
              <p className="text-xs text-muted-foreground mt-1">可访问所有 Worker 和团队</p>
              <div className="mt-1.5">
                {humans?.filter((h) => h.permissionLevel === 3).map((h) => (
                  <Badge key={h.name} variant="outline" className="text-[10px] mr-1">{h.displayName || h.name}</Badge>
                ))}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-background/50">
              <Badge className="bg-amber-500/10 text-amber-600 dark:text-amber-400 mb-2" variant="secondary">Team Leader</Badge>
              <p className="text-xs text-muted-foreground">
                <code className="font-mono">groupAllowFrom: [&quot;team-a&quot;]</code>
              </p>
              <p className="text-xs text-muted-foreground mt-1">仅可访问 team-a 下的 Worker</p>
              <div className="mt-1.5">
                {humans?.filter((h) => h.permissionLevel === 2).map((h) => (
                  <Badge key={h.name} variant="outline" className="text-[10px] mr-1">{h.displayName || h.name}</Badge>
                ))}
              </div>
            </div>
            <div className="p-3 rounded-lg bg-background/50">
              <Badge className="bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 mb-2" variant="secondary">Observer</Badge>
              <p className="text-xs text-muted-foreground">
                <code className="font-mono">groupAllowFrom: [&quot;worker-1&quot;]</code>
              </p>
              <p className="text-xs text-muted-foreground mt-1">仅可访问指定独立 Worker</p>
              <div className="mt-1.5">
                {humans?.filter((h) => {
                  const level = h.permissionLevel;
                  return !level || level === 1;
                }).map((h) => (
                  <Badge key={h.name} variant="outline" className="text-[10px] mr-1">{h.displayName || h.name}</Badge>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Security Best Practices Checklist */}
      <Card className="glass-card">
        <CardHeader className="pb-3">
          <CardTitle className="text-sm flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4" />
            安全合规检查
            <Badge variant="outline" className="text-[10px] ml-auto">
              {checkedCount}/{securityChecks.length} 通过
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="space-y-2">
            {securityChecks.map((check, i) => (
              <motion.div
                key={check.label}
                initial={{ opacity: 0, x: -10 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05 }}
                className={`flex items-start gap-3 p-2.5 rounded-lg ${check.checked ? 'bg-emerald-500/5' : 'bg-amber-500/5'}`}
              >
                {check.checked ? (
                  <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0 mt-0.5" />
                ) : (
                  <XCircle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                )}
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className={`text-sm ${check.checked ? 'text-foreground' : 'text-foreground'}`}>{check.label}</span>
                    <Badge variant={check.checked ? 'outline' : 'secondary'} className={`text-[10px] ${check.checked ? 'text-emerald-600 border-emerald-500/30' : 'text-amber-600'}`}>
                      {check.checked ? '通过' : '待改进'}
                    </Badge>
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5">{check.detail}</p>
                </div>
              </motion.div>
            ))}
          </div>
          {/* Overall score */}
          <div className="mt-4 p-3 rounded-lg bg-muted/30 flex items-center gap-3">
            <div className={`text-2xl font-bold ${checkedCount === securityChecks.length ? 'text-emerald-500' : checkedCount >= securityChecks.length / 2 ? 'text-amber-500' : 'text-red-500'}`}>
              {Math.round((checkedCount / securityChecks.length) * 100)}%
            </div>
            <div>
              <p className="text-sm font-medium">安全合规率</p>
              <p className="text-xs text-muted-foreground">
                {checkedCount === securityChecks.length
                  ? '所有安全检查已通过'
                  : `还有 ${securityChecks.length - checkedCount} 项待改进`}
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
