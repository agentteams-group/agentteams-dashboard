'use client';

import { useMemo, useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import {
  Bot,
  Users,
  MessageSquare,
  Wifi,
  WifiOff,
  Server,
  Cpu,
  Zap,
  GitBranch,
  Clock,
  Activity,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Plus,
  Crown,
  UserPlus,
  MessageCircle,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import type { WorkerResponse, TeamResponse, ManagerResponse, InfrastructureInfo } from '@/lib/agentteams-api';
import { useClusterStatus } from '@/hooks/use-agentteams-cluster-status';
import { useVersion } from '@/hooks/use-agentteams-version';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useTeams } from '@/hooks/use-agentteams-teams';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useInfrastructure } from '@/hooks/use-agentteams-infrastructure';
import { computeInsights, type Insight } from '@/lib/insights-engine';
import { useDeploymentMode } from '@/hooks/use-deployment-mode';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { WORKER_PHASE_COLORS } from '@/lib/phase-colors';
import { useNotificationStore } from '@/lib/notification-store';
import { useCounter } from '@/hooks/use-counter';
import { PieChart, Pie, Cell, BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Legend } from 'recharts';

// ============ Auto-refresh countdown hook ============
function useRefreshCountdown(intervalMs: number) {
  const [countdown, setCountdown] = useState(() => intervalMs / 1000);
  const startTimeRef = useRef(Date.now());

  // Restart the cycle when the interval changes (adjust state during render)
  const [prevIntervalMs, setPrevIntervalMs] = useState(intervalMs);
  if (prevIntervalMs !== intervalMs) {
    setPrevIntervalMs(intervalMs);
    setCountdown(intervalMs / 1000);
  }

  useEffect(() => {
    startTimeRef.current = Date.now();

    const interval = setInterval(() => {
      const elapsed = Date.now() - startTimeRef.current;
      const remaining = Math.max(0, Math.ceil((intervalMs - elapsed) / 1000));
      setCountdown(remaining);

      // Reset cycle when countdown reaches zero
      if (remaining <= 0) {
        startTimeRef.current = Date.now();
        setCountdown(intervalMs / 1000);
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [intervalMs]);

  return countdown;
}

// ============ AnimatedStat component (kept from original) ============
function AnimatedStat({ value, label, icon: Icon, color, sub }: { value: number | null; label: string; icon: React.ComponentType<{ className?: string }>; color: string; sub?: React.ReactNode }) {
  const animatedValue = useCounter(value ?? 0, 800);
  return (
    <Card className="glass-card hover-lift">
      <CardContent className="p-4">
        <div className="flex items-center justify-between">
          <div className="min-w-0 flex-1">
            <p className="text-xs text-muted-foreground">{label}</p>
            {value !== null ? (
              <p className="text-2xl font-bold mt-1">{animatedValue}</p>
            ) : (
              <p className="text-2xl font-bold mt-1 text-muted-foreground">—</p>
            )}
            {sub && <div className="mt-1">{sub}</div>}
          </div>
          <Icon className={`w-8 h-8 ${color} opacity-80 flex-shrink-0`} />
        </div>
      </CardContent>
    </Card>
  );
}

// ============ Phase Breakdown Mini-Bar ============
function PhaseMiniBar({ workers }: { workers: { phase: string }[] }) {
  const phases = useMemo(() => {
    const counts: Record<string, number> = {};
    workers.forEach((w) => {
      counts[w.phase] = (counts[w.phase] || 0) + 1;
    });
    return counts;
  }, [workers]);

  const total = workers.length || 1;

  const orderedPhases = ['Running', 'Ready', 'Sleeping', 'Failed', 'Pending', 'Stopped', 'Updating'];

  return (
    <div className="flex items-center gap-0.5 h-2 rounded-full overflow-hidden bg-muted/30 mt-1">
      {orderedPhases.map((phase) => {
        const count = phases[phase] || 0;
        if (count === 0) return null;
        const pct = (count / total) * 100;
        return (
          <div
            key={phase}
            className="h-full transition-all duration-500"
            style={{ width: `${pct}%`, backgroundColor: WORKER_PHASE_COLORS[phase] || '#6b7280' }}
            title={`${phase}: ${count}`}
          />
        );
      })}
    </div>
  );
}

// ============ Activity Feed Item ============
function ActivityFeedItem({ notification }: { notification: ReturnType<typeof useNotificationStore.getState>['notifications'][0] }) {
  const iconMap = {
    success: <CheckCircle2 className="w-4 h-4 text-emerald-500 flex-shrink-0" />,
    error: <XCircle className="w-4 h-4 text-red-500 flex-shrink-0" />,
    warning: <AlertTriangle className="w-4 h-4 text-amber-500 flex-shrink-0" />,
    info: <Info className="w-4 h-4 text-blue-500 flex-shrink-0" />,
  };

  const timeStr = useMemo(() => {
    const now = Date.now();
    const diff = now - notification.timestamp;
    if (diff < 60000) return `${Math.floor(diff / 1000)}秒前`;
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    return `${Math.floor(diff / 86400000)}天前`;
  }, [notification.timestamp]);

  return (
    <div className="flex items-start gap-2.5 py-2 px-2 rounded-lg hover:bg-accent/50 transition-colors">
      {iconMap[notification.type]}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{notification.title}</p>
        <p className="text-xs text-muted-foreground truncate">{notification.message}</p>
      </div>
      <span className="text-[10px] text-muted-foreground whitespace-nowrap flex-shrink-0">{timeStr}</span>
    </div>
  );
}

// ============ Infrastructure Health Card ============
function HealthCard({ name, healthy, icon: Icon, detail }: { name: string; healthy: boolean | undefined; icon: React.ComponentType<{ className?: string }>; detail?: string }) {
  const isHealthy = healthy === true;
  const isUnknown = healthy === undefined || healthy === null;
  const pct = isUnknown ? 0 : isHealthy ? 100 : 15;

  return (
    <div className="flex items-center gap-3 p-3 rounded-lg bg-background/50 border border-border/50">
      <Icon className={`w-4 h-4 flex-shrink-0 ${isHealthy ? 'text-emerald-500' : isUnknown ? 'text-gray-400' : 'text-red-500'}`} />
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between mb-1">
          <span className="text-xs font-medium">{name}</span>
          <Badge
            variant="outline"
            className={`text-[10px] h-4 px-1.5 ${
              isHealthy
                ? 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400'
                : isUnknown
                  ? 'border-gray-400/30 text-gray-500'
                  : 'border-red-500/30 text-red-600 dark:text-red-400'
            }`}
          >
            {isHealthy ? '健康' : isUnknown ? '未知' : '异常'}
          </Badge>
        </div>
        <Progress value={pct} className="h-1.5" />
        {detail && <p className="text-[10px] text-muted-foreground mt-0.5 truncate">{detail}</p>}
      </div>
    </div>
  );
}

// ============ Main OverviewSection ============
export function OverviewSection() {
  const { isConnected } = useAgentTeamsStore();
  const { data: clusterStatus } = useClusterStatus();
  const { data: versionData } = useVersion();
  const { data: workers } = useWorkers();
  const { data: teams } = useTeams();
  const { data: managers } = useManagers();
  const { data: infrastructure } = useInfrastructure();
  const { mode } = useDeploymentMode();
  const notifications = useNotificationStore((s) => s.notifications);

  // ---- Computed values ----

  // Active Workers = Running or Ready
  const activeWorkers = isConnected ? (workers?.filter((w) => w.phase === 'Running' || w.phase === 'Ready').length ?? 0) : null;

  // Phase breakdown for mini-bar
  const phaseBreakdown = useMemo(() => {
    if (!workers) return { Running: 0, Ready: 0, Sleeping: 0, Failed: 0 };
    return {
      Running: workers.filter((w) => w.phase === 'Running').length,
      Ready: workers.filter((w) => w.phase === 'Ready').length,
      Sleeping: workers.filter((w) => w.phase === 'Sleeping').length,
      Failed: workers.filter((w) => w.phase === 'Failed').length,
    };
  }, [workers]);

  // Active Teams
  const activeTeams = isConnected ? (teams?.filter((t) => t.phase === 'Active').length ?? 0) : null;
  const totalTeams = teams?.length ?? 0;
  const readinessPct = totalTeams > 0 ? Math.round(((activeTeams ?? 0) / totalTeams) * 100) : 0;

  // Matrix Rooms
  const matrixRooms = isConnected
    ? new Set([
        ...(workers?.map((w) => w.roomID).filter(Boolean) ?? []),
        ...(teams?.map((t) => t.teamRoomID).filter(Boolean) ?? []),
        ...(managers?.map((m) => m.roomID).filter(Boolean) ?? []),
      ]).size
    : null;

  // Managers with online/offline split
  const managersOnline = managers?.filter((m) => m.phase === 'Running').length ?? 0;
  const managersTotal = managers?.length ?? 0;

  // Unique skills count from workers

  // Worker Phase Distribution for PieChart
  const phaseData = useMemo(() => {
    if (!workers) return [];
    const phases: Record<string, number> = {};
    workers.forEach((w) => {
      phases[w.phase] = (phases[w.phase] || 0) + 1;
    });
    return Object.entries(phases).map(([name, value]) => ({ name, value }));
  }, [workers]);

  // Team Readiness for BarChart
  const teamReadinessData = useMemo(() => {
    if (!teams) return [];
    return teams.map((t) => {
      const name = t.name || '';
      return {
        name: name.length > 10 ? `${name.slice(0, 10)}...` : name,
        ready: t.readyWorkers ?? 0,
        total: t.totalWorkers ?? 0,
      };
    });
  }, [teams]);

  // Activity feed: last 10 notifications sorted by timestamp descending
  const recentActivity = useMemo(() => {
    return [...notifications]
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 10);
  }, [notifications]);

  // Auto-refresh countdown (15s interval)
  const countdown = useRefreshCountdown(15000);

  return (
    <div className="space-y-4">
      {/* ===== Row 1: Compact Status Bar ===== */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        className="glass-card p-3 flex flex-wrap items-center gap-2"
      >
        {/* Connection Status */}
        <Badge
          className={`gap-1 ${
            isConnected
              ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20'
              : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
          }`}
          variant="outline"
        >
          {isConnected ? <Wifi className="w-3 h-3" /> : <WifiOff className="w-3 h-3" />}
          {isConnected ? '已连接' : '未连接'}
        </Badge>

        {/* Controller Version */}
        {versionData?.controller && (
          <Badge variant="outline" className="text-xs gap-1">
            <GitBranch className="w-3 h-3" />
            v{versionData.controller}
          </Badge>
        )}

        {/* K8s Mode */}
        {(clusterStatus?.kubeMode || versionData?.kubeMode) && (
          <Badge variant="outline" className="text-xs gap-1 border-cyan-500/30 text-cyan-600 dark:text-cyan-400">
            <Cpu className="w-3 h-3" />
            K8s 模式
          </Badge>
        )}

        {/* Uptime / Last Connected */}
        <div className="flex items-center gap-1 text-xs text-muted-foreground ml-auto">
          <Clock className="w-3 h-3" />
          <span>自动刷新 {countdown}s</span>
          <Activity className="w-3 h-3 ml-1 animate-pulse text-emerald-500" />
        </div>
      </motion.div>

      {/* ===== Row 2: Key Metrics (4 cards) ===== */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.05 }}>
          <AnimatedStat
            value={activeWorkers}
            label="活跃 Workers"
            icon={Bot}
            color="text-primary"
            sub={
              workers && workers.length > 0 ? (
                <div className="space-y-0.5">
                  <PhaseMiniBar workers={workers} />
                  <div className="flex gap-2 text-[10px] text-muted-foreground">
                    <span className="text-emerald-500">运行 {phaseBreakdown.Running}</span>
                    <span className="text-green-500">就绪 {phaseBreakdown.Ready}</span>
                    <span className="text-blue-500">休眠 {phaseBreakdown.Sleeping}</span>
                    {phaseBreakdown.Failed > 0 && <span className="text-red-500">失败 {phaseBreakdown.Failed}</span>}
                  </div>
                </div>
              ) : undefined
            }
          />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
          <AnimatedStat
            value={activeTeams}
            label="活跃团队"
            icon={Users}
            color="text-emerald-500"
            sub={
              totalTeams > 0 ? (
                <div className="flex items-center gap-2">
                  <Progress value={readinessPct} className="h-1.5 flex-1" />
                  <span className="text-[10px] text-muted-foreground">{readinessPct}%</span>
                </div>
              ) : undefined
            }
          />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.15 }}>
          <AnimatedStat
            value={matrixRooms}
            label="Matrix 房间"
            icon={MessageSquare}
            color="text-cyan-500"
          />
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
          <AnimatedStat
            value={isConnected ? managersTotal : null}
            label="Managers"
            icon={Crown}
            color="text-violet-500"
            sub={
              managersTotal > 0 ? (
                <div className="flex gap-2 text-[10px] text-muted-foreground">
                  <span className="text-emerald-500">在线 {managersOnline}</span>
                  <span className="text-gray-400">离线 {managersTotal - managersOnline}</span>
                </div>
              ) : undefined
            }
          />
        </motion.div>
      </div>

      {/* ===== Insights Bar ===== */}
      <InsightsBar
        workers={workers}
        teams={teams}
        managers={managers}
        infrastructure={infrastructure ?? undefined}
        isConnected={isConnected}
      />

      {/* ===== Row 3: Charts (two-column) ===== */}
      {isConnected && workers && workers.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {/* Worker Phase Distribution PieChart */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25 }}>
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">Worker 阶段分布</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {phaseData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie
                        data={phaseData}
                        cx="50%"
                        cy="50%"
                        innerRadius={50}
                        outerRadius={80}
                        paddingAngle={3}
                        dataKey="value"
                        label={({ name, value }) => `${name}: ${value}`}
                      >
                        {phaseData.map((entry) => (
                          <Cell key={entry.name} fill={WORKER_PHASE_COLORS[entry.name] || '#6b7280'} />
                        ))}
                      </Pie>
                      <RechartsTooltip />
                      <Legend />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
                    暂无 Worker 数据
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          {/* Team Readiness BarChart */}
          <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold">团队就绪状态</CardTitle>
              </CardHeader>
              <CardContent className="p-4 pt-0">
                {teamReadinessData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={teamReadinessData}>
                      <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                      <RechartsTooltip />
                      <Legend />
                      <Bar dataKey="ready" name="就绪 Workers" fill="#10b981" radius={[2, 2, 0, 0]} />
                      <Bar dataKey="total" name="总 Workers" fill="#2ABC74" radius={[2, 2, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
                    暂无团队数据
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>
        </div>
      )}

      {/* ===== Row 4: Activity Feed + Infrastructure Health ===== */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Activity Feed */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.35 }}>
          <Card className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Activity className="w-4 h-4 text-primary" />
                操作动态
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {recentActivity.length > 0 ? (
                <div className="max-h-72 overflow-y-auto custom-scrollbar space-y-0.5">
                  {recentActivity.map((n) => (
                    <ActivityFeedItem key={n.id} notification={n} />
                  ))}
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Activity className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-sm">暂无操作动态</p>
                  <p className="text-xs">执行操作后将在此显示</p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        {/* Infrastructure Health */}
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold flex items-center gap-2">
                <Server className="w-4 h-4 text-cyan-500" />
                基础设施健康
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0">
              {isConnected && infrastructure ? (
                <div className="space-y-2">
                  {/* MinIO: embedded only */}
                  {mode !== 'k8s' && (
                    <HealthCard
                      name="MinIO"
                      healthy={infrastructure.minio?.healthy}
                      icon={Server}
                      detail={infrastructure.minio?.endpoint}
                    />
                  )}
                  {/* Higress: k8s only */}
                  {mode !== 'embedded' && (
                    <HealthCard
                      name="Higress"
                      healthy={infrastructure.higress?.healthy}
                      icon={Zap}
                      detail={infrastructure.higress?.endpoint}
                    />
                  )}
                  <HealthCard
                    name="Matrix"
                    healthy={infrastructure.matrix?.healthy}
                    icon={MessageSquare}
                    detail={infrastructure.matrix?.homeserver}
                  />
                  {/* Kubernetes: k8s only */}
                  {mode !== 'embedded' && (
                    <HealthCard
                      name="Kubernetes"
                      healthy={infrastructure.kubernetes?.healthy}
                      icon={Cpu}
                      detail={infrastructure.kubernetes?.version}
                    />
                  )}
                  <HealthCard
                    name="Controller"
                    healthy={infrastructure.controller?.healthy}
                    icon={GitBranch}
                    detail={infrastructure.controller?.version}
                  />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center py-8 text-muted-foreground">
                  <Server className="w-8 h-8 mb-2 opacity-30" />
                  <p className="text-sm">
                    {isConnected ? '未获取到基础设施信息' : '连接 Controller 后查看基础设施状态'}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>

      {/* ===== Row 5: Quick Actions ===== */}
      <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.45 }}>
        <Card className="glass-card">
          <CardContent className="p-4">
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-muted-foreground mr-1">快捷操作:</span>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => { window.location.hash = 'workers'; }}>
                <Plus className="w-3.5 h-3.5" />
                创建 Worker
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => { window.location.hash = 'teams'; }}>
                <Plus className="w-3.5 h-3.5" />
                创建团队
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => { window.location.hash = 'humans'; }}>
                <UserPlus className="w-3.5 h-3.5" />
                创建用户
              </Button>
              <Button variant="outline" size="sm" className="h-8 text-xs gap-1.5" onClick={() => { window.location.hash = 'chat'; }}>
                <MessageCircle className="w-3.5 h-3.5" />
                Matrix 聊天
              </Button>
            </div>
          </CardContent>
        </Card>
      </motion.div>
    </div>
  );
}

// ============ Insights Bar ============
function InsightsBar({
  workers,
  teams,
  managers,
  infrastructure,
  isConnected,
}: {
  workers: WorkerResponse[] | undefined;
  teams: TeamResponse[] | undefined;
  managers: ManagerResponse[] | undefined;
  infrastructure: InfrastructureInfo | undefined;
  isConnected: boolean;
}) {
  const insights = useMemo(
    () => computeInsights(workers, teams, managers, infrastructure, isConnected),
    [workers, teams, managers, infrastructure, isConnected]
  );

  if (insights.length === 0) return null;

  return (
    <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-none">
      {insights.map((insight) => (
        <InsightBadge key={insight.id} insight={insight} />
      ))}
    </div>
  );
}

function InsightBadge({ insight }: { insight: Insight }) {
  const Icon =
    insight.severity === 'critical'
      ? XCircle
      : insight.severity === 'warning'
        ? AlertTriangle
        : insight.category === 'health'
          ? CheckCircle2
          : Info;

  const colorClass =
    insight.severity === 'critical'
      ? 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20'
      : insight.severity === 'warning'
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
        : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20';

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Badge
          variant="outline"
          className={`gap-1.5 text-[10px] whitespace-nowrap cursor-default ${colorClass}`}
        >
          <Icon className="w-3 h-3 shrink-0" />
          {insight.message}
        </Badge>
      </TooltipTrigger>
      {insight.detail && (
        <TooltipContent>
          <p className="text-xs max-w-xs">{insight.detail}</p>
        </TooltipContent>
      )}
    </Tooltip>
  );
}
