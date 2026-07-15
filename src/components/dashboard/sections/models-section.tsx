'use client';

import { useState } from 'react';
import {
  Trash2,
  Loader2,
  Plus,
  Server,
  Key,
  Route,
  AlertTriangle,
} from 'lucide-react';
import { SectionHeader } from '@/components/dashboard/section-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useModels,
  useCreateModel,
  useDeleteModel,
  useAiRoutes,
  useCreateAiRoute,
  useDeleteAiRoute,
} from '@/hooks/use-agentteams-models';
import {
  PROVIDER_TYPES,
  PROVIDERS_NEED_BASE_URL,
  type CreateLlmProviderRequest,
  type CreateAiRouteRequest,
} from '@/lib/higress-api';

export function ModelsSection() {
  const { data: providers, isLoading } = useModels();
  const { data: routes, isLoading: routesLoading } = useAiRoutes();
  const createProvider = useCreateModel();
  const deleteProvider = useDeleteModel();
  const createRoute = useCreateAiRoute();
  const deleteRoute = useDeleteAiRoute();

  const [showAddProvider, setShowAddProvider] = useState(false);
  const [showAddRoute, setShowAddRoute] = useState(false);
  const [providerForm, setProviderForm] = useState<CreateLlmProviderRequest>({
    name: '',
    type: 'openai',
    tokens: [],
  });
  const [apiKeyInput, setApiKeyInput] = useState('');
  const [routeForm, setRouteForm] = useState<CreateAiRouteRequest>({
    name: '',
    pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
    upstreams: [{ provider: '', weight: 100 }],
    authConfig: { enabled: true, allowedCredentialTypes: ['key-auth'] },
  });

  const needsBaseUrl = PROVIDERS_NEED_BASE_URL.has(providerForm.type);

  const handleCreateProvider = () => {
    if (!providerForm.name.trim()) return;
    const tokens = apiKeyInput
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
    if (tokens.length === 0) return;

    const payload: CreateLlmProviderRequest = {
      ...providerForm,
      tokens,
    };
    // Add custom URL if needed
    if (needsBaseUrl && providerForm.rawConfigs?.openaiCustomUrl) {
      payload.rawConfigs = providerForm.rawConfigs;
    }

    createProvider.mutate(payload, {
      onSuccess: () => {
        setProviderForm({ name: '', type: 'openai', tokens: [] });
        setApiKeyInput('');
        setShowAddProvider(false);
      },
    });
  };

  const handleCreateRoute = () => {
    if (!routeForm.name.trim()) return;
    if (!routeForm.upstreams[0]?.provider) return;

    createRoute.mutate(routeForm, {
      onSuccess: () => {
        setRouteForm({
          name: '',
          pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
          upstreams: [{ provider: '', weight: 100 }],
          authConfig: { enabled: true, allowedCredentialTypes: ['key-auth'] },
        });
        setShowAddRoute(false);
      },
    });
  };

  return (
    <div className="space-y-8">
      {/* ---- AI Providers Section ---- */}
      <div className="space-y-4">
        <SectionHeader
          title="AI 模型提供商"
          description="通过 Higress 网关管理 LLM 提供商配置（API Key 由网关安全存储，不暴露给前端）"
        />

        {/* Add Provider Form */}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddProvider((v) => !v)}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            添加提供商
          </Button>
          {!isLoading && providers && (
            <span className="text-xs text-muted-foreground">
              共 {providers.length} 个提供商
            </span>
          )}
        </div>

        {showAddProvider && (
          <div className="border border-border rounded-lg p-4 space-y-4 bg-card/50">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              <div>
                <Label>名称 *</Label>
                <Input
                  value={providerForm.name}
                  onChange={(e) =>
                    setProviderForm({ ...providerForm, name: e.target.value })
                  }
                  placeholder="例如 my-openai"
                />
              </div>
              <div>
                <Label>类型 *</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
                  value={providerForm.type}
                  onChange={(e) =>
                    setProviderForm({ ...providerForm, type: e.target.value })
                  }
                >
                  {PROVIDER_TYPES.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div className={needsBaseUrl ? '' : 'lg:col-span-2'}>
                <Label>API Key * (多个用逗号分隔)</Label>
                <Input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  placeholder="sk-xxx, sk-yyy (用于轮换)"
                />
              </div>
              {needsBaseUrl && (
                <div>
                  <Label>自定义 Base URL</Label>
                  <Input
                    value={
                      (providerForm.rawConfigs?.openaiCustomUrl as string) || ''
                    }
                    onChange={(e) =>
                      setProviderForm({
                        ...providerForm,
                        rawConfigs: {
                          ...providerForm.rawConfigs,
                          openaiCustomUrl: e.target.value,
                        },
                      })
                    }
                    placeholder="https://api.openai.com/v1"
                  />
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleCreateProvider}
                disabled={
                  !providerForm.name.trim() ||
                  !apiKeyInput.trim() ||
                  createProvider.isPending
                }
              >
                {createProvider.isPending && (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                )}
                创建
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddProvider(false)}
              >
                取消
              </Button>
            </div>
            {createProvider.isError && (
              <p className="text-xs text-red-500">
                {createProvider.error?.message}
              </p>
            )}
          </div>
        )}

        {/* Providers Table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>类型</TableHead>
              <TableHead>协议</TableHead>
              <TableHead>Token 数</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {isLoading && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                  加载中...
                </TableCell>
              </TableRow>
            )}
            {!isLoading && providers?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  <Server className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                  暂无 AI 提供商配置
                  <br />
                  <span className="text-[10px]">
                    点击「添加提供商」开始配置 LLM API
                  </span>
                </TableCell>
              </TableRow>
            )}
            {providers?.map((provider) => {
              const typeInfo = PROVIDER_TYPES.find(
                (t) => t.value === provider.type
              );
              return (
                <TableRow key={provider.name}>
                  <TableCell className="font-medium">
                    <div className="flex items-center gap-2">
                      <Server className="w-3.5 h-3.5 text-muted-foreground" />
                      {provider.name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant="outline" className="text-[10px]">
                      {typeInfo?.label || provider.type}
                    </Badge>
                  </TableCell>
                  <TableCell className="font-mono text-xs text-muted-foreground">
                    {provider.protocol || 'openai/v1'}
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Key className="w-3 h-3 text-muted-foreground" />
                      <span className="text-xs">
                        {provider.tokenCount} 个
                      </span>
                    </div>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => deleteProvider.mutate(provider.name)}
                      disabled={deleteProvider.isPending}
                    >
                      <Trash2 className="w-4 h-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      {/* ---- AI Routes Section ---- */}
      <div className="space-y-4">
        <SectionHeader
          title="AI 路由"
          description="配置请求路由规则，支持多提供商权重分配和模型级路由"
        />

        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={() => setShowAddRoute((v) => !v)}
          >
            <Plus className="w-3.5 h-3.5 mr-1" />
            添加路由
          </Button>
          {!routesLoading && routes && (
            <span className="text-xs text-muted-foreground">
              共 {routes.length} 条路由
            </span>
          )}
        </div>

        {showAddRoute && (
          <div className="border border-border rounded-lg p-4 space-y-4 bg-card/50">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <div>
                <Label>路由名称 *</Label>
                <Input
                  value={routeForm.name}
                  onChange={(e) =>
                    setRouteForm({ ...routeForm, name: e.target.value })
                  }
                  placeholder="例如 agentteams-default"
                />
              </div>
              <div>
                <Label>路径前缀</Label>
                <Input
                  value={routeForm.pathPredicate.matchValue}
                  onChange={(e) =>
                    setRouteForm({
                      ...routeForm,
                      pathPredicate: {
                        ...routeForm.pathPredicate,
                        matchValue: e.target.value,
                      },
                    })
                  }
                  placeholder="/v1/chat/completions"
                />
              </div>
              <div>
                <Label>目标提供商 *</Label>
                <select
                  className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors"
                  value={routeForm.upstreams[0]?.provider || ''}
                  onChange={(e) =>
                    setRouteForm({
                      ...routeForm,
                      upstreams: [
                        {
                          ...routeForm.upstreams[0],
                          provider: e.target.value,
                        },
                      ],
                    })
                  }
                >
                  <option value="">选择提供商...</option>
                  {providers?.map((p) => (
                    <option key={p.name} value={p.name}>
                      {p.name} ({p.type})
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Button
                size="sm"
                onClick={handleCreateRoute}
                disabled={
                  !routeForm.name.trim() ||
                  !routeForm.upstreams[0]?.provider ||
                  createRoute.isPending
                }
              >
                {createRoute.isPending && (
                  <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
                )}
                创建
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setShowAddRoute(false)}
              >
                取消
              </Button>
            </div>
            {createRoute.isError && (
              <p className="text-xs text-red-500">
                {createRoute.error?.message}
              </p>
            )}
          </div>
        )}

        {/* Routes Table */}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>名称</TableHead>
              <TableHead>路径</TableHead>
              <TableHead>上游提供商</TableHead>
              <TableHead>认证</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {routesLoading && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  <Loader2 className="w-4 h-4 animate-spin inline mr-2" />
                  加载中...
                </TableCell>
              </TableRow>
            )}
            {!routesLoading && routes?.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={5}
                  className="text-center text-muted-foreground"
                >
                  <Route className="w-8 h-8 mx-auto mb-2 text-muted-foreground/50" />
                  暂无 AI 路由
                  <br />
                  <span className="text-[10px]">
                    创建提供商后，添加路由以启用 AI 网关
                  </span>
                </TableCell>
              </TableRow>
            )}
            {routes?.map((route) => (
              <TableRow key={route.name}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    <Route className="w-3.5 h-3.5 text-muted-foreground" />
                    {route.name}
                  </div>
                </TableCell>
                <TableCell className="font-mono text-xs text-muted-foreground">
                  {route.pathPredicate?.matchValue || '-'}
                </TableCell>
                <TableCell>
                  <div className="flex flex-wrap gap-1">
                    {route.upstreams?.map((u, i) => (
                      <Badge key={i} variant="secondary" className="text-[10px]">
                        {u.provider}
                        {u.weight < 100 && ` (${u.weight}%)`}
                      </Badge>
                    ))}
                  </div>
                </TableCell>
                <TableCell>
                  {route.authConfig?.enabled ? (
                    <Badge variant="outline" className="text-[10px] text-emerald-50">
                      已启用
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

      {/* ---- Info Banner ---- */}
      <div className="border border-border/50 rounded-lg p-4 bg-muted/30">
        <div className="flex items-start gap-3">
          <AlertTriangle className="w-5 h-5 text-amber-500 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Higress 网关管理</p>
            <p className="text-xs text-muted-foreground">
              模型配置通过 Higress Console API 管理，API Key 由网关安全存储。
              提供商创建后，需要创建对应的 AI 路由才能启用 AI 代理功能。
            </p>
            <p className="text-xs text-muted-foreground">
              支持多 Token 轮换、故障转移、多提供商权重路由等高级功能。
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
