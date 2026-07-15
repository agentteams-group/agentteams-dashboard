'use client';

import { useState, useCallback } from 'react';
import {
  Shield,
  Key,
  Route,
  Plus,
  Trash2,
  Loader2,
  ToggleLeft,
  ToggleRight,
  AlertTriangle,
  CheckCircle2,
  Users,
  Gauge,
  Clock,
  Zap,
  Save,
} from 'lucide-react';
import { SectionHeader } from '@/components/dashboard/section-header';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { toast } from 'sonner';
import { useConsumers } from '@/hooks/use-agentteams-consumers';
import { useCreateConsumer, useDeleteConsumer } from '@/hooks/use-agentteams-mutations';
import { useAiRoutes, useDeleteAiRoute } from '@/hooks/use-agentteams-models';
import { formatErrorMessage } from '@/lib/api-error';

export function GatewaySection() {
  const {
    data: consumers,
    isLoading: consumersLoading,
    error: consumersError,
    listUnsupported: consumerListUnsupported,
  } = useConsumers();
  const { data: routes, isLoading: routesLoading } = useAiRoutes();
  const createConsumer = useCreateConsumer();
  const deleteConsumer = useDeleteConsumer();
  const deleteRoute = useDeleteAiRoute();

  const [showAddConsumer, setShowAddConsumer] = useState(false);
  const [consumerName, setConsumerName] = useState('');
  const [consumerKey, setConsumerKey] = useState('');

  const handleCreateConsumer = async () => {
    if (!consumerName.trim()) return;
    try {
      await createConsumer.mutateAsync({
        name: consumerName.trim(),
        password: consumerKey.trim() || `${consumerName.trim()}-${Date.now()}`,
      });
      toast.success(`Consumer "${consumerName}" 创建成功`);
      setConsumerName('');
      setConsumerKey('');
      setShowAddConsumer(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    }
  };

  const handleDeleteConsumer = async (id: string) => {
    if (!confirm(`确认删除 Consumer "${id}"？`)) return;
    try {
      await deleteConsumer.mutateAsync(id);
      toast.success('Consumer 已删除');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  };

  return (
    <div className="space-y-6">
      <SectionHeader
        title="网关管理"
        description="管理 Higress API 网关的 Consumer（认证凭证）和 AI 路由"
      />

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Card className="glass-card">
          <CardContent className="p-3 flex items-center gap-3">
            <Users className="w-8 h-8 text-violet-500" />
            <div>
              <p className="text-2xl font-bold">{consumers?.length ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">Consumers</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-3 flex items-center gap-3">
            <Route className="w-8 h-8 text-cyan-500" />
            <div>
              <p className="text-2xl font-bold">{routes?.length ?? 0}</p>
              <p className="text-[10px] text-muted-foreground">AI 路由</p>
            </div>
          </CardContent>
        </Card>
        <Card className="glass-card">
          <CardContent className="p-3 flex items-center gap-3">
            <Shield className="w-8 h-8 text-emerald-500" />
            <div>
              <p className="text-2xl font-bold">
                {routes?.filter((r) => r.authConfig?.enabled).length ?? 0}
              </p>
              <p className="text-[10px] text-muted-foreground">已认证路由</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Consumers */}
      <div className="space-y-3">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">Consumers（认证凭证）</h3>
          <Button variant="outline" size="sm" onClick={() => setShowAddConsumer((v) => !v)}>
            <Plus className="w-3.5 h-3.5 mr-1" />
            添加 Consumer
          </Button>
        </div>

        {showAddConsumer && (
          <div className="flex items-end gap-2 p-3 border border-border rounded-lg bg-card/50">
            <div className="flex-1">
              <Label className="text-xs">名称</Label>
              <Input
                value={consumerName}
                onChange={(e) => setConsumerName(e.target.value)}
                placeholder="consumer-name"
                className="h-8 text-sm"
              />
            </div>
            <div className="flex-1">
              <Label className="text-xs">密码 (可选)</Label>
              <Input
                value={consumerKey}
                onChange={(e) => setConsumerKey(e.target.value)}
                placeholder="留空自动生成"
                type="password"
                className="h-8 text-sm"
              />
            </div>
            <Button
              size="sm"
              onClick={handleCreateConsumer}
              disabled={!consumerName.trim() || createConsumer.isPending}
            >
              {createConsumer.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '创建'}
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowAddConsumer(false)}>
              取消
            </Button>
          </div>
        )}

        {consumerListUnsupported && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-muted-foreground">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <p>
              当前 Controller 版本不支持获取 Consumer 列表（v1.2.0-beta.1 缺少 GET
              /api/v1/gateway/consumers），仍可创建新 Consumer。
            </p>
          </div>
        )}
        {consumersError && (
          <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <p>Consumer 列表加载失败: {formatErrorMessage(consumersError)}</p>
          </div>
        )}

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>凭证</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {consumersLoading && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                  加载中...
                </TableCell>
              </TableRow>
            )}
            {!consumersLoading && consumers?.length === 0 && (
              <TableRow>
                <TableCell colSpan={3} className="text-center text-muted-foreground">
                  暂无 Consumer
                </TableCell>
              </TableRow>
            )}
            {consumers?.map((consumer) => (
              <TableRow key={consumer.name}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Key className="w-3.5 h-3.5 text-muted-foreground" />
                    {consumer.name}
                  </div>
                </TableCell>
                <TableCell>
                  {consumer.status && (
                    <Badge variant="outline" className="text-[10px]">
                      {consumer.status}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => handleDeleteConsumer(consumer.name)}
                    disabled={deleteConsumer.isPending}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* AI Routes */}
      <div className="space-y-3">
        <h3 className="text-sm font-semibold">AI 路由</h3>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>路径</TableHead>
              <TableHead>上游</TableHead>
              <TableHead>认证</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routesLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                  加载中...
                </TableCell>
              </TableRow>
            )}
            {!routesLoading && routes?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  暂无 AI 路由
                </TableCell>
              </TableRow>
            )}
            {routes?.map((route) => (
              <TableRow key={route.name}>
                <TableCell className="font-medium">{route.name}</TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {route.pathPredicate?.matchValue || '-'}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {route.upstreams?.map((u, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px]">
                        {u.provider} ({u.weight}%)
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  {route.authConfig?.enabled ? (
                    <Badge variant="outline" className="text-[10px] text-emerald-500">
                      <CheckCircle2 className="w-3 h-3 mr-1" />
                      启用
                    </Badge>
                  ) : (
                    <span className="text-xs text-muted-foreground">-</span>
                  )}
                </TableCell>
                <TableCell className="text-right">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => deleteRoute.mutate(route.name)}
                    disabled={deleteRoute.isPending}
                  >
                    <Trash2 className="w-4 h-4 text-destructive" />
                  </Button>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      {/* Rate Limiting Configuration */}
      <RateLimitSection routes={routes} />
    </div>
  );
}

// ============ Rate Limit Plugin Configuration ============

interface RateLimitConfig {
  routeName: string;
  enabled: boolean;
  rps: number;           // requests per second
  rpm: number;           // requests per minute
  burst: number;         // burst size
  perConsumer: boolean;  // per-consumer or global
}

const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  routeName: '',
  enabled: true,
  rps: 10,
  rpm: 600,
  burst: 20,
  perConsumer: true,
};

function RateLimitSection({ routes }: { routes: Array<{ name: string }> | undefined }) {
  const [configs, setConfigs] = useState<RateLimitConfig[]>([]);
  const [showAdd, setShowAdd] = useState(false);
  const [newConfig, setNewConfig] = useState<RateLimitConfig>({ ...DEFAULT_RATE_LIMIT });

  const handleAdd = useCallback(() => {
    if (!newConfig.routeName) return;
    setConfigs((prev) => [...prev, { ...newConfig }]);
    setNewConfig({ ...DEFAULT_RATE_LIMIT });
    setShowAdd(false);
  }, [newConfig]);

  const handleRemove = useCallback((idx: number) => {
    setConfigs((prev) => prev.filter((_, i) => i !== idx));
  }, []);

  const handleToggle = useCallback((idx: number) => {
    setConfigs((prev) =>
      prev.map((c, i) => (i === idx ? { ...c, enabled: !c.enabled } : c))
    );
  }, []);

  const handleUpdateField = useCallback(
    <K extends keyof RateLimitConfig>(idx: number, field: K, value: RateLimitConfig[K]) => {
      setConfigs((prev) =>
        prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c))
      );
    },
    []
  );

  const handleExportConfig = useCallback(() => {
    // Export as Higress WASM plugin config format
    const pluginConfigs = configs
      .filter((c) => c.enabled)
      .map((c) => ({
        routeName: c.routeName,
        pluginName: 'wasm-rate-limit',
        config: {
          rule_name: `rate-limit-${c.routeName}`,
          limit_by_header: c.perConsumer ? 'x-consumer-name' : undefined,
          rate: c.rps > 0 ? `${c.rps}` : undefined,
          rpm: c.rpm > 0 ? `${c.rpm}` : undefined,
          burst: c.burst > 0 ? `${c.burst}` : undefined,
          show_limit_quota_header: true,
        },
      }));
    const blob = new Blob([JSON.stringify(pluginConfigs, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'higress-rate-limit-config.json';
    a.click();
    URL.revokeObjectURL(url);
  }, [configs]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold flex items-center gap-2">
          <Gauge className="w-4 h-4 text-amber-500" />
          限流策略 (Rate Limit)
        </h3>
        <div className="flex items-center gap-2">
          {configs.length > 0 && (
            <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleExportConfig}>
              <Save className="w-3 h-3 mr-1" />
              导出配置
            </Button>
          )}
          <Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAdd((v) => !v)}>
            <Plus className="w-3 h-3 mr-1" />
            添加限流规则
          </Button>
        </div>
      </div>

      {/* Add form */}
      {showAdd && (
        <div className="border border-border rounded-lg p-4 space-y-3 bg-card/50">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div>
              <label className="text-xs text-muted-foreground">目标路由 *</label>
              <select
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                value={newConfig.routeName}
                onChange={(e) => setNewConfig({ ...newConfig, routeName: e.target.value })}
              >
                <option value="">选择路由...</option>
                {routes?.map((r) => (
                  <option key={r.name} value={r.name}>{r.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-muted-foreground">RPS (每秒请求数)</label>
              <input
                type="number"
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                value={newConfig.rps}
                onChange={(e) => setNewConfig({ ...newConfig, rps: parseInt(e.target.value) || 0 })}
                min={0}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">RPM (每分钟请求数)</label>
              <input
                type="number"
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                value={newConfig.rpm}
                onChange={(e) => setNewConfig({ ...newConfig, rpm: parseInt(e.target.value) || 0 })}
                min={0}
              />
            </div>
            <div>
              <label className="text-xs text-muted-foreground">突发容量</label>
              <input
                type="number"
                className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm"
                value={newConfig.burst}
                onChange={(e) => setNewConfig({ ...newConfig, burst: parseInt(e.target.value) || 0 })}
                min={0}
              />
            </div>
          </div>
          <div className="flex items-center gap-3">
            <label className="flex items-center gap-2 text-xs cursor-pointer">
              <input
                type="checkbox"
                checked={newConfig.perConsumer}
                onChange={(e) => setNewConfig({ ...newConfig, perConsumer: e.target.checked })}
                className="rounded"
              />
              按 Consumer 限流（不同 Consumer 独立计数）
            </label>
          </div>
          <div className="flex items-center gap-2">
            <Button size="sm" onClick={handleAdd} disabled={!newConfig.routeName}>
              添加
            </Button>
            <Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>
              取消
            </Button>
          </div>
        </div>
      )}

      {/* Config list */}
      {configs.length === 0 && !showAdd && (
        <p className="text-xs text-muted-foreground text-center py-4">
          暂无限流规则。点击「添加限流规则」为 AI 路由配置请求频率限制。
        </p>
      )}

      {configs.map((config, idx) => (
        <div
          key={`${config.routeName}-${idx}`}
          className={`flex items-center gap-3 p-3 rounded-lg border ${
            config.enabled ? 'border-border bg-card/50' : 'border-border/50 bg-muted/20 opacity-60'
          }`}
        >
          <button onClick={() => handleToggle(idx)}>
            {config.enabled ? (
              <ToggleRight className="w-5 h-5 text-emerald-500" />
            ) : (
              <ToggleLeft className="w-5 h-5 text-gray-400" />
            )}
          </button>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <Route className="w-3.5 h-3.5 text-muted-foreground" />
              <span className="text-xs font-medium">{config.routeName}</span>
              {config.perConsumer && (
                <Badge variant="secondary" className="text-[9px]">按 Consumer</Badge>
              )}
            </div>
            <div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">
              {config.rps > 0 && (
                <span className="flex items-center gap-1">
                  <Zap className="w-3 h-3" />
                  {config.rps} req/s
                </span>
              )}
              {config.rpm > 0 && (
                <span className="flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  {config.rpm} req/min
                </span>
              )}
              {config.burst > 0 && <span>突发: {config.burst}</span>}
            </div>
          </div>
          {/* Inline edit */}
          <input
            type="number"
            className="w-16 h-7 rounded border border-input bg-transparent px-1.5 text-xs text-center"
            value={config.rps}
            onChange={(e) => handleUpdateField(idx, 'rps', parseInt(e.target.value) || 0)}
            title="RPS"
          />
          <span className="text-[10px] text-muted-foreground">req/s</span>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleRemove(idx)}>
            <Trash2 className="w-3.5 h-3.5 text-destructive" />
          </Button>
        </div>
      ))}

      {configs.length > 0 && (
        <div className="border border-border/50 rounded-lg p-3 bg-muted/20">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div className="text-[10px] text-muted-foreground space-y-0.5">
              <p>限流配置导出后需通过 Higress Console API 或 kubectl 应用到网关。</p>
              <p>配置格式: Higress <code>wasm-rate-limit</code> 插件，支持 per-route 和 per-consumer 限流。</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
