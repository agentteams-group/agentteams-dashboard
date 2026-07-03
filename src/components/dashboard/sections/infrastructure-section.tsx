'use client';

import { useState, useMemo, useCallback, useEffect, useReducer } from 'react';
import { motion } from 'framer-motion';
import { apiUrl } from '@/lib/api-base';
import {
  Server,
  Zap,
  MessageSquare,
  Cpu,
  GitBranch,
  Plus,
  CheckCircle2,
  XCircle,
  HelpCircle,
  Loader2,
  Wifi,
  Clock,
  HardDrive,
  Globe,
  Box,
  Shield,
} from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Separator } from '@/components/ui/separator';
import {
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui/tooltip';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { useInfrastructure } from '@/hooks/use-hiclaw-infrastructure';
import { useVersion } from '@/hooks/use-hiclaw-version';
import { useHiClawStatus } from '@/hooks/use-hiclaw-status';
import { useCreateConsumer } from '@/hooks/use-hiclaw-mutations';
import { useHiClawStore } from '@/lib/hiclaw-store';
import { useSearch } from '@/lib/search-context';
import { ApiErrorState } from '@/components/dashboard/api-error-state';
import { SectionHeader } from '@/components/dashboard/section-header';
import type { InfrastructureInfo } from '@/lib/hiclaw-api';

// ============ Shared Colors ============

const HEALTH_COLORS = {
  healthy: {
    bar: 'bg-emerald-500',
    barIndicator: '[&>[data-slot=progress-indicator]]:bg-emerald-500',
    text: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-500/10',
    badge: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
  },
  unhealthy: {
    bar: 'bg-red-500',
    barIndicator: '[&>[data-slot=progress-indicator]]:bg-red-500',
    text: 'text-red-600 dark:text-red-400',
    bg: 'bg-red-500/10',
    badge: 'bg-red-500/10 text-red-600 dark:text-red-400',
  },
  unknown: {
    bar: 'bg-gray-400',
    barIndicator: '[&>[data-slot=progress-indicator]]:bg-gray-400',
    text: 'text-gray-600 dark:text-gray-400',
    bg: 'bg-gray-500/10',
    badge: 'bg-gray-500/10 text-gray-600 dark:text-gray-400',
  },
} as const;

// ============ Component Config ============

const componentIcons: Record<string, React.ComponentType<{ className?: string }>> = {
  minio: Server,
  higress: Zap,
  matrix: MessageSquare,
  kubernetes: Cpu,
  controller: GitBranch,
};

const componentNames: Record<string, string> = {
  minio: 'MinIO 对象存储',
  higress: 'Higress 网关',
  matrix: 'Matrix 通信',
  kubernetes: 'Kubernetes',
  controller: 'HiClaw Controller',
};

const componentDescriptions: Record<string, string> = {
  minio: 'S3 兼容对象存储服务',
  higress: '云原生 API 网关',
  matrix: '去中心化即时通信协议',
  kubernetes: '容器编排平台',
  controller: 'HiClaw 核心控制器',
};

// ============ Uptime Tracker Hook ============

interface UptimeRecord {
  healthyCount: number;
  totalChecks: number;
  lastHealthyAt: number | null;
  lastCheckedAt: number | null;
  sessionStart: number;
}

function useUptimeTracker(components: { name: string; healthy: boolean }[]) {
  const [records, dispatch] = useReducer(
    (
      prev: Record<string, UptimeRecord>,
      action: { type: 'update'; components: { name: string; healthy: boolean }[] }
    ) => {
      const now = Date.now();
      const next = { ...prev };
      for (const comp of action.components) {
        if (!next[comp.name]) {
          next[comp.name] = {
            healthyCount: 0,
            totalChecks: 0,
            lastHealthyAt: null,
            lastCheckedAt: null,
            sessionStart: now,
          };
        }
        next[comp.name] = {
          ...next[comp.name],
          totalChecks: next[comp.name].totalChecks + 1,
          lastCheckedAt: now,
          healthyCount: next[comp.name].healthyCount + (comp.healthy ? 1 : 0),
          lastHealthyAt: comp.healthy ? now : next[comp.name].lastHealthyAt,
        };
      }
      return next;
    },
    {}
  );

  useEffect(() => {
    dispatch({ type: 'update', components });
  }, [components]);

  return records;
}

// ============ Health Card Component ============

function HealthCard({
  name,
  data,
  uptimeRecord,
  onTestConnection,
  testState,
}: {
  name: string;
  data: { healthy: boolean; endpoint?: string; homeserver?: string; version?: string; buckets?: string[] };
  uptimeRecord?: UptimeRecord;
  onTestConnection: () => void;
  testState: 'idle' | 'testing' | 'success' | 'failed';
}) {
  const Icon = componentIcons[name] || Server;
  const label = componentNames[name] || name;
  const description = componentDescriptions[name] || '';

  const healthPct = data.healthy ? 100 : 0;
  const colors = data.healthy ? HEALTH_COLORS.healthy : HEALTH_COLORS.unhealthy;

  const uptimePct = uptimeRecord && uptimeRecord.totalChecks > 0
    ? Math.round((uptimeRecord.healthyCount / uptimeRecord.totalChecks) * 100)
    : null;

  const lastCheckedStr = uptimeRecord?.lastCheckedAt
    ? new Date(uptimeRecord.lastCheckedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : null;

  const healthySinceStr = uptimeRecord?.lastHealthyAt
    ? formatRelativeTime(uptimeRecord.lastHealthyAt)
    : null;

  return (
    <Card className="glass-card hover-lift">
      <CardContent className="p-4">
        {/* Header: Icon + Name + Status Icon */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`p-1.5 rounded-md ${colors.bg}`}>
              <Icon className={`w-4 h-4 ${colors.text}`} />
            </div>
            <div>
              <span className="font-medium text-sm">{label}</span>
              <p className="text-[10px] text-muted-foreground">{description}</p>
            </div>
          </div>
          <Tooltip>
            <TooltipTrigger asChild>
              <div>
                {data.healthy ? (
                  <CheckCircle2 className="w-5 h-5 text-emerald-500" />
                ) : (
                  <XCircle className="w-5 h-5 text-red-500" />
                )}
              </div>
            </TooltipTrigger>
            <TooltipContent>
              {data.healthy ? '组件运行正常' : '组件状态异常'}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Health Percentage Bar */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-muted-foreground">健康度</span>
            <span className={`text-xs font-semibold ${colors.text}`}>
              {healthPct}%
            </span>
          </div>
          <Progress
            value={healthPct}
            className={`h-2 ${colors.barIndicator}`}
          />
        </div>

        {/* Status Badge */}
        <div className="flex items-center justify-between mb-2">
          <Badge className={`text-[10px] ${colors.badge}`}>
            {data.healthy ? '健康' : '异常'}
          </Badge>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={onTestConnection}
            disabled={testState === 'testing'}
          >
            {testState === 'testing' ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                测试中
              </>
            ) : testState === 'success' ? (
              <>
                <CheckCircle2 className="w-3 h-3 mr-1 text-emerald-500" />
                连通
              </>
            ) : testState === 'failed' ? (
              <>
                <XCircle className="w-3 h-3 mr-1 text-red-500" />
                失败
              </>
            ) : (
              <>
                <Wifi className="w-3 h-3 mr-1" />
                测试连接
              </>
            )}
          </Button>
        </div>

        {/* Additional Info */}
        {data.buckets && data.buckets.length > 0 && (
          <div className="mb-2">
            <p className="text-[10px] text-muted-foreground mb-1">
              存储桶 ({data.buckets.length})
            </p>
            <div className="flex flex-wrap gap-1">
              {data.buckets.map((b) => (
                <Badge key={b} variant="outline" className="text-[10px]">{b}</Badge>
              ))}
            </div>
          </div>
        )}

        {data.homeserver && (
          <p className="text-xs text-muted-foreground font-mono truncate mb-1" title={data.homeserver}>
            {data.homeserver}
          </p>
        )}

        {data.endpoint && !data.homeserver && (
          <p className="text-xs text-muted-foreground font-mono truncate mb-1" title={data.endpoint}>
            {data.endpoint}
          </p>
        )}

        {data.version && (
          <p className="text-xs text-muted-foreground mb-1">
            版本: <span className="font-mono">{data.version}</span>
          </p>
        )}

        {/* Uptime Info */}
        <Separator className="my-2" />
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
            <Clock className="w-3 h-3" />
            {uptimePct !== null ? (
              <span>会话可用率 {uptimePct}%</span>
            ) : (
              <span>暂无数据</span>
            )}
          </div>
          {lastCheckedStr && (
            <span className="text-[10px] text-muted-foreground">
              {healthySinceStr ? `持续健康 ${healthySinceStr}` : `检查于 ${lastCheckedStr}`}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

// ============ Helper: Relative Time ============

function formatRelativeTime(timestamp: number): string {
  const diff = Date.now() - timestamp;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return `${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}分钟`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}小时`;
  const days = Math.floor(hours / 24);
  return `${days}天`;
}

// ============ Main Component ============

export function InfrastructureSection() {
  const { data: infrastructure, isLoading, isError, refetch, isRefetching } = useInfrastructure();
  const { data: versionData } = useVersion();
  const { data: healthData } = useHiClawStatus();
  const { isConnected } = useHiClawStore();
  const { searchQuery } = useSearch();
  const createConsumer = useCreateConsumer();
  const [consumerOpen, setConsumerOpen] = useState(false);
  const [consumerData, setConsumerData] = useState({ name: '', password: '' });

  // Connection test states: per component
  const [testStates, setTestStates] = useState<Record<string, 'idle' | 'testing' | 'success' | 'failed'>>({});

  const handleRefresh = useCallback(() => {
    refetch();
  }, [refetch]);

  const handleCreateConsumer = () => {
    createConsumer.mutate(consumerData, {
      onSuccess: () => {
        setConsumerOpen(false);
        setConsumerData({ name: '', password: '' });
      },
    });
  };

  const derivedHealth = useMemo(() => {
    if (infrastructure) return infrastructure;
    const isHealthy = healthData === 'ok';
    const result: InfrastructureInfo = {};
    result.controller = {
      healthy: isHealthy,
      version: versionData?.controller || 'unknown',
    };
    return result;
  }, [infrastructure, healthData, versionData]);

  const componentsList = useMemo(() => {
    const components: { name: string; healthy: boolean }[] = [];
    if (derivedHealth.minio) components.push({ name: 'minio', healthy: derivedHealth.minio.healthy });
    if (derivedHealth.higress) components.push({ name: 'higress', healthy: derivedHealth.higress.healthy });
    if (derivedHealth.matrix) components.push({ name: 'matrix', healthy: derivedHealth.matrix.healthy });
    if (derivedHealth.kubernetes) components.push({ name: 'kubernetes', healthy: derivedHealth.kubernetes.healthy });
    if (derivedHealth.controller) components.push({ name: 'controller', healthy: derivedHealth.controller.healthy });
    return components;
  }, [derivedHealth]);

  // Uptime tracking
  const uptimeRecords = useUptimeTracker(componentsList);

  const healthSummary = useMemo(() => {
    const total = componentsList.length;
    const healthy = componentsList.filter((c) => c.healthy).length;
    return { total, healthy };
  }, [componentsList]);

  const filteredComponents = useMemo(() => {
    if (!derivedHealth) return [];
    const entries = Object.entries(derivedHealth).filter(([_, data]) => data && typeof data === 'object');
    if (!searchQuery) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter(([key]) => {
      const label = componentNames[key] || key;
      return key.toLowerCase().includes(q) || label.toLowerCase().includes(q);
    });
  }, [derivedHealth, searchQuery]);

  // Connection test handler
  const handleTestConnection = useCallback(async (name: string, data: { endpoint?: string; homeserver?: string }) => {
    setTestStates((prev) => ({ ...prev, [name]: 'testing' }));

    try {
      if (name === 'matrix' && data.homeserver) {
        // Test Matrix /_matrix/client/versions endpoint
        const url = data.homeserver.replace(/\/$/, '');
        const res = await fetch(`${url}/_matrix/client/versions`, {
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          setTestStates((prev) => ({ ...prev, [name]: 'success' }));
        } else {
          setTestStates((prev) => ({ ...prev, [name]: 'failed' }));
        }
      } else if (name === 'minio' && data.endpoint) {
        // Test MinIO health endpoint
        const url = data.endpoint.replace(/\/$/, '');
        const res = await fetch(`${url}/minio/health/live`, {
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          setTestStates((prev) => ({ ...prev, [name]: 'success' }));
        } else {
          setTestStates((prev) => ({ ...prev, [name]: 'failed' }));
        }
      } else {
        // Use infrastructure API for others
        const res = await fetch(apiUrl('/api/hiclaw/infrastructure'), {
          signal: AbortSignal.timeout(8000),
        });
        if (res.ok) {
          const infraData: InfrastructureInfo = await res.json();
          const comp = infraData[name as keyof InfrastructureInfo];
          if (comp && typeof comp === 'object' && 'healthy' in comp && comp.healthy) {
            setTestStates((prev) => ({ ...prev, [name]: 'success' }));
          } else {
            setTestStates((prev) => ({ ...prev, [name]: 'failed' }));
          }
        } else {
          setTestStates((prev) => ({ ...prev, [name]: 'failed' }));
        }
      }

      // Reset test state after 5 seconds
      setTimeout(() => {
        setTestStates((prev) => {
          if (prev[name] === 'success' || prev[name] === 'failed') {
            return { ...prev, [name]: 'idle' };
          }
          return prev;
        });
      }, 5000);
    } catch {
      setTestStates((prev) => ({ ...prev, [name]: 'failed' }));
      setTimeout(() => {
        setTestStates((prev) => {
          if (prev[name] === 'failed') {
            return { ...prev, [name]: 'idle' };
          }
          return prev;
        });
      }, 5000);
    }
  }, []);

  // Resource overview derived data
  const resourceItems = useMemo(() => {
    const items: { icon: React.ComponentType<{ className?: string }>; label: string; value: string; detail: string; healthy: boolean }[] = [];

    // Storage (MinIO)
    const minioBuckets = derivedHealth?.minio?.buckets?.length ?? 0;
    const minioHealthy = derivedHealth?.minio?.healthy;
    items.push({
      icon: HardDrive,
      label: 'MinIO 存储',
      value: `${minioBuckets} 桶`,
      detail: minioHealthy ? '服务正常' : '服务异常',
      healthy: minioHealthy ?? false,
    });

    // Network (Higress)
    const higressHealthy = derivedHealth?.higress?.healthy;
    const higressEndpoint = derivedHealth?.higress?.endpoint;
    items.push({
      icon: Globe,
      label: '网络端点',
      value: higressHealthy ? '运行中' : '未就绪',
      detail: higressEndpoint ? higressEndpoint.replace(/^https?:\/\//, '') : '无端点',
      healthy: higressHealthy ?? false,
    });

    // Matrix
    const matrixHealthy = derivedHealth?.matrix?.healthy;
    const matrixHomeserver = derivedHealth?.matrix?.homeserver;
    items.push({
      icon: MessageSquare,
      label: 'Matrix 服务',
      value: matrixHealthy ? '运行中' : '未就绪',
      detail: matrixHomeserver ? matrixHomeserver.replace(/^https?:\/\//, '') : '无地址',
      healthy: matrixHealthy ?? false,
    });

    // K8s
    const k8sHealthy = derivedHealth?.kubernetes?.healthy;
    const k8sVersion = derivedHealth?.kubernetes?.version;
    items.push({
      icon: Box,
      label: 'K8s 集群',
      value: k8sVersion || '未知',
      detail: k8sHealthy ? '集群健康' : '集群异常',
      healthy: k8sHealthy ?? false,
    });

    // Controller
    const ctrlHealthy = derivedHealth?.controller?.healthy;
    const ctrlVersion = derivedHealth?.controller?.version;
    items.push({
      icon: Shield,
      label: 'Controller',
      value: ctrlVersion || '未知',
      detail: ctrlHealthy ? '运行中' : '离线',
      healthy: ctrlHealthy ?? false,
    });

    return items;
  }, [derivedHealth]);

  if (isError && !isConnected && !derivedHealth) {
    return <ApiErrorState />;
  }

  return (
    <div className="space-y-6">
      <SectionHeader
        title="基础设施"
        description="监控和管理基础设施组件"
        isLive={isConnected}
        onRefresh={handleRefresh}
        isRefreshing={isRefetching}
        actions={
          <Button
            size="sm"
            className="bg-gradient-to-r from-orange-500 to-red-500 text-white hover:from-orange-600 hover:to-red-600"
            onClick={() => setConsumerOpen(true)}
          >
            <Plus className="w-4 h-4 mr-1" />
            创建消费者
          </Button>
        }
      />

      {/* Health Summary Bar */}
      <Card className="glass-card">
        <CardContent className="p-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div className="flex items-center gap-3">
              <h3 className="text-sm font-semibold">健康状态总览</h3>
              {!infrastructure && (
                <Badge variant="outline" className="text-[10px] text-amber-500">
                  推断模式
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-3">
              <Badge
                variant={healthSummary.healthy === healthSummary.total && healthSummary.total > 0 ? 'default' : 'destructive'}
                className="text-xs"
              >
                {healthSummary.healthy}/{healthSummary.total} 健康
              </Badge>
              {healthSummary.total > 0 && (
                <div className="flex items-center gap-2">
                  <Progress
                    value={healthSummary.total > 0 ? (healthSummary.healthy / healthSummary.total) * 100 : 0}
                    className={`h-2 w-24 ${
                      healthSummary.healthy === healthSummary.total
                        ? HEALTH_COLORS.healthy.barIndicator
                        : HEALTH_COLORS.unhealthy.barIndicator
                    }`}
                  />
                  <span className="text-xs text-muted-foreground">
                    {healthSummary.total > 0 ? Math.round((healthSummary.healthy / healthSummary.total) * 100) : 0}%
                  </span>
                </div>
              )}
              <div className="flex gap-1">
                {componentsList.map((comp) => (
                  <Tooltip key={comp.name}>
                    <TooltipTrigger asChild>
                      <div
                        className={`w-3 h-3 rounded-full ${
                          comp.healthy ? 'bg-emerald-500' : 'bg-red-500'
                        }`}
                      />
                    </TooltipTrigger>
                    <TooltipContent>
                      {componentNames[comp.name] || comp.name}: {comp.healthy ? '健康' : '异常'}
                    </TooltipContent>
                  </Tooltip>
                ))}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Component Health Cards */}
      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <Card key={i} className="glass-card">
              <CardContent className="p-4 space-y-2">
                <div className="h-5 shimmer rounded w-24" />
                <div className="h-4 shimmer rounded w-16" />
                <div className="h-2 shimmer rounded w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : filteredComponents.length === 0 ? (
        <Card className="glass-card">
          <CardContent className="p-12 text-center">
            <HelpCircle className="w-12 h-12 text-muted-foreground mx-auto mb-4" />
            <p className="text-muted-foreground">未获取到基础设施信息</p>
            <p className="text-xs text-muted-foreground mt-1">
              Controller 可能不支持此端点，或连接异常
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredComponents.map(([key, data], i) => {
            if (!data || typeof data !== 'object') return null;
            const compData = data as { healthy: boolean; endpoint?: string; homeserver?: string; version?: string; buckets?: string[] };
            return (
              <motion.div
                key={key}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.05 }}
                layout
              >
                <HealthCard
                  name={key}
                  data={compData}
                  uptimeRecord={uptimeRecords[key]}
                  onTestConnection={() => handleTestConnection(key, compData)}
                  testState={testStates[key] || 'idle'}
                />
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Resource Overview - Dynamic */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="text-sm">资源使用概览</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
            {resourceItems.map((item) => {
              const ItemIcon = item.icon;
              return (
                <div key={item.label} className="flex items-start gap-3 p-3 rounded-lg bg-muted/30">
                  <div className={`p-1.5 rounded-md ${item.healthy ? HEALTH_COLORS.healthy.bg : HEALTH_COLORS.unhealthy.bg}`}>
                    <ItemIcon className={`w-4 h-4 ${item.healthy ? HEALTH_COLORS.healthy.text : HEALTH_COLORS.unhealthy.text}`} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-muted-foreground">{item.label}</p>
                    <p className="text-sm font-medium truncate">{item.value}</p>
                    <p className="text-[10px] text-muted-foreground truncate" title={item.detail}>
                      {item.detail}
                    </p>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Create Consumer Dialog */}
      <Dialog open={consumerOpen} onOpenChange={setConsumerOpen}>
        <DialogContent className="sm:max-w-md max-w-[95vw]">
          <DialogHeader>
            <DialogTitle>创建网关消费者</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>用户名</Label>
              <Input
                value={consumerData.name}
                onChange={(e) => setConsumerData({ ...consumerData, name: e.target.value })}
                placeholder="consumer-username"
              />
            </div>
            <div className="space-y-2">
              <Label>密码</Label>
              <Input
                type="password"
                value={consumerData.password}
                onChange={(e) => setConsumerData({ ...consumerData, password: e.target.value })}
                placeholder="密码"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConsumerOpen(false)}>取消</Button>
            <Button
              onClick={handleCreateConsumer}
              disabled={!consumerData.name || !consumerData.password || createConsumer.isPending}
              className="bg-gradient-to-r from-orange-500 to-red-500 text-white hover:from-orange-600 hover:to-red-600"
            >
              {createConsumer.isPending ? '创建中...' : '创建'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
