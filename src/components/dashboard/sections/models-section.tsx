'use client';

import { useState, useCallback, type ReactNode } from 'react';
import { AlertTriangle, Clock, Gauge, Key, Loader2, Pencil, Plus, Route, Save, Server, ToggleLeft, ToggleRight, Trash2, Users, Zap } from 'lucide-react';
import { SectionHeader } from '@/components/dashboard/section-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  useAiRoutes,
  useCreateAiRoute,
  useCreateModel,
  useDeleteAiRoute,
  useDeleteModel,
  useModels,
  useUpdateAiRoute,
  useUpdateModel,
} from '@/hooks/use-agentteams-models';
import { useManagers } from '@/hooks/use-agentteams-managers';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { useConsumers } from '@/hooks/use-agentteams-consumers';
import { useCreateConsumer, useDeleteConsumer } from '@/hooks/use-agentteams-mutations';
import {
  parseFallbackConfig,
  PROVIDERS_NEED_BASE_URL,
  PROVIDER_TYPES,
  serializeProviderForm,
  serializeRouteForm,
  summarizeFallbackConfig,
  validateProviderForm,
  validateRouteForm,
  type AiRoute,
  type LlmProviderResponse,
  type ModelMappingRule,
  type ProviderForm,
  type RouteForm,
} from '@/lib/higress-api';
import { buildModelBindings } from '@/lib/model-bindings';
import { useHigressConsoleAccess } from '@/hooks/use-higress-console-access';
import { formatErrorMessage } from '@/lib/api-error';
import { toast } from 'sonner';

const newProviderForm = (): ProviderForm => ({
  name: '', type: 'openai', protocol: 'openai/v1', tokens: [], modelMappings: [],
});

const newRouteForm = (): RouteForm => ({
  name: '',
  pathPredicate: { matchType: 'PRE', matchValue: '/v1/chat/completions' },
  upstreams: [{ provider: '', weight: 100, modelMappings: [] }],
  modelPredicates: [],
  authConfig: { enabled: true, allowedCredentialTypes: ['key-auth'] },
});

function mappingRules(value: unknown): ModelMappingRule[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.entries(value as Record<string, unknown>)
    .filter((entry): entry is [string, string] => typeof entry[1] === 'string')
    .map(([pattern, targetModel]) => ({ pattern, targetModel }));
}

function providerToForm(provider: LlmProviderResponse): ProviderForm {
  const rawConfigs = provider.rawConfigs ?? {};
  return {
    name: provider.name,
    type: provider.type,
    protocol: provider.protocol === 'original' ? 'original' : 'openai/v1',
    tokens: [],
    baseUrl: typeof rawConfigs.openaiCustomUrl === 'string' ? rawConfigs.openaiCustomUrl : '',
    tokenFailoverConfig: provider.tokenFailoverConfig,
    modelMappings: mappingRules(rawConfigs.modelMapping),
  };
}

function routeToForm(route: AiRoute): RouteForm {
  return {
    name: route.name,
    pathPredicate: route.pathPredicate,
    upstreams: route.upstreams.map((upstream) => ({
      provider: upstream.provider,
      weight: upstream.weight,
      modelMappings: mappingRules(upstream.modelMapping),
    })),
    modelPredicates: route.modelPredicates ?? [],
    authConfig: route.authConfig ?? { enabled: true, allowedCredentialTypes: ['key-auth'] },
    fallbackConfig: route.fallbackConfig,
  };
}

function FormErrors({ errors }: { errors: string[] }) {
  return errors.length > 0 ? <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{errors.map((error) => <p key={error}>{error}</p>)}</div> : null;
}

function MappingEditor({ value, onChange }: { value: ModelMappingRule[]; onChange: (_value: ModelMappingRule[]) => void }) {
  return <div className="space-y-2">
    <div className="flex items-center justify-between"><Label>模型映射</Label><Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { pattern: '', targetModel: '' }])}><Plus className="mr-1 size-3" />添加映射</Button></div>
    {value.map((mapping, index) => <div className="flex gap-2" key={index}>
      <Input aria-label="匹配模型" value={mapping.pattern} placeholder="请求模型" onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, pattern: event.target.value } : item))} />
      <Input aria-label="目标模型" value={mapping.targetModel} placeholder="目标模型" onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, targetModel: event.target.value } : item))} />
      <Button type="button" variant="ghost" size="icon" aria-label="删除模型映射" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-4 text-destructive" /></Button>
    </div>)}
  </div>;
}

function ProviderDialog({ open, provider, onOpenChange }: { open: boolean; provider: LlmProviderResponse | null; onOpenChange: (_open: boolean) => void }) {
  const create = useCreateModel();
  const update = useUpdateModel();
  const [form, setForm] = useState<ProviderForm>(() => provider ? providerToForm(provider) : newProviderForm());
  const [tokenInput, setTokenInput] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const editing = Boolean(provider);
  const pending = create.isPending || update.isPending;

  const submit = () => {
    const tokens = tokenInput.split(',').map((token) => token.trim()).filter(Boolean);
    const next = { ...form, tokens: tokens.length > 0 ? tokens : form.tokens };
    const nextErrors = validateProviderForm(next, editing);
    if (nextErrors.length > 0) return setErrors(nextErrors);
    const onSuccess = () => onOpenChange(false);
    if (provider) update.mutate({ name: provider.name, data: serializeProviderForm(next, true) }, { onSuccess, onError: (error) => setErrors([error.message]) });
    else create.mutate(serializeProviderForm(next) as Parameters<typeof create.mutate>[0], { onSuccess, onError: (error) => setErrors([error.message]) });
  };

  const failover = form.tokenFailoverConfig ?? { enabled: false, failureThreshold: 1, successThreshold: 1, healthCheckInterval: 30, healthCheckModel: '' };
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto"><DialogHeader><DialogTitle>{editing ? `编辑提供商 - ${provider?.name}` : '创建提供商'}</DialogTitle></DialogHeader><div className="space-y-4 py-2">
    <div className="grid gap-3 md:grid-cols-3">
      <div><Label>名称 *</Label><Input disabled={editing || pending} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
      <div><Label>类型 *</Label><select disabled={pending} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value })}>{PROVIDER_TYPES.map((type) => <option key={type.value} value={type.value}>{type.label}</option>)}</select></div>
      <div><Label>协议</Label><select disabled={pending} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value as ProviderForm['protocol'] })}><option value="openai/v1">openai/v1</option><option value="original">original</option></select></div>
    </div>
    <div><Label>{editing ? `新增 Token（当前 ${provider?.tokenCount ?? 0} 个，留空保留）` : 'API Key *（多个用逗号分隔）'}</Label><Input disabled={pending} type="password" value={tokenInput} onChange={(event) => setTokenInput(event.target.value)} /></div>
    {PROVIDERS_NEED_BASE_URL.has(form.type) && <div><Label>自定义 Base URL</Label><Input disabled={pending} value={form.baseUrl ?? ''} onChange={(event) => setForm({ ...form, baseUrl: event.target.value })} placeholder="https://api.example.com/v1" /></div>}
    <div className="space-y-3 rounded-md border p-3"><div className="flex items-center gap-2"><Input id="provider-failover" className="size-4" type="checkbox" checked={failover.enabled} disabled={pending} onChange={(event) => setForm({ ...form, tokenFailoverConfig: { ...failover, enabled: event.target.checked } })} /><Label htmlFor="provider-failover">启用 Token 故障转移</Label></div>{failover.enabled && <div className="grid gap-3 md:grid-cols-4"><div><Label>失败阈值</Label><Input disabled={pending} type="number" min="1" value={failover.failureThreshold} onChange={(event) => setForm({ ...form, tokenFailoverConfig: { ...failover, failureThreshold: Number(event.target.value) } })} /></div><div><Label>成功阈值</Label><Input disabled={pending} type="number" min="1" value={failover.successThreshold} onChange={(event) => setForm({ ...form, tokenFailoverConfig: { ...failover, successThreshold: Number(event.target.value) } })} /></div><div><Label>检查间隔（秒）</Label><Input disabled={pending} type="number" min="1" value={failover.healthCheckInterval} onChange={(event) => setForm({ ...form, tokenFailoverConfig: { ...failover, healthCheckInterval: Number(event.target.value) } })} /></div><div><Label>健康检查模型</Label><Input disabled={pending} value={failover.healthCheckModel} onChange={(event) => setForm({ ...form, tokenFailoverConfig: { ...failover, healthCheckModel: event.target.value } })} /></div></div>}</div>
    <MappingEditor value={form.modelMappings} onChange={(modelMappings) => setForm({ ...form, modelMappings })} />
    <FormErrors errors={errors} />
  </div><DialogFooter><Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>取消</Button><Button disabled={pending} onClick={submit}>{pending && <Loader2 className="mr-1 size-4 animate-spin" />}{editing ? '保存修改' : '创建提供商'}</Button></DialogFooter></DialogContent></Dialog>;
}

function RouteDialog({ open, route, providerNames, fallbackConfigWritable, onOpenChange }: { open: boolean; route: AiRoute | null; providerNames: string[]; fallbackConfigWritable: boolean; onOpenChange: (_open: boolean) => void }) {
  const create = useCreateAiRoute();
  const update = useUpdateAiRoute();
  const [form, setForm] = useState<RouteForm>(() => route ? routeToForm(route) : newRouteForm());
  const [fallbackJson, setFallbackJson] = useState(() => route?.fallbackConfig ? JSON.stringify(route.fallbackConfig, null, 2) : '');
  const [errors, setErrors] = useState<string[]>([]);
  const editing = Boolean(route);
  const pending = create.isPending || update.isPending;
  const submit = () => {
    const parsedFallback = parseFallbackConfig(fallbackJson);
    const next = { ...form, fallbackConfig: parsedFallback.config };
    const nextErrors = [...validateRouteForm(next, providerNames), ...(parsedFallback.error ? [parsedFallback.error] : [])];
    if (nextErrors.length > 0) return setErrors(nextErrors);
    const payload = serializeRouteForm(next);
    const onSuccess = () => onOpenChange(false);
    if (route) update.mutate({ name: route.name, data: payload }, { onSuccess, onError: (error) => setErrors([error.message]) });
    else create.mutate(payload, { onSuccess, onError: (error) => setErrors([error.message]) });
  };
  const updateUpstream = (index: number, patch: Partial<RouteForm['upstreams'][number]>) => setForm({ ...form, upstreams: form.upstreams.map((upstream, upstreamIndex) => upstreamIndex === index ? { ...upstream, ...patch } : upstream) });
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto"><DialogHeader><DialogTitle>{editing ? `编辑路由 - ${route?.name}` : '创建 AI 路由'}</DialogTitle></DialogHeader><div className="space-y-4 py-2">
    <div className="grid gap-3 md:grid-cols-3"><div><Label>路由名称 *</Label><Input disabled={editing || pending} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div><div><Label>路径匹配类型</Label><select disabled={pending} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.pathPredicate.matchType} onChange={(event) => setForm({ ...form, pathPredicate: { ...form.pathPredicate, matchType: event.target.value } })}><option value="PRE">前缀（PRE）</option><option value="EXACT">精确（EXACT）</option></select></div><div><Label>路径匹配 *</Label><Input disabled={pending} value={form.pathPredicate.matchValue} onChange={(event) => setForm({ ...form, pathPredicate: { ...form.pathPredicate, matchValue: event.target.value } })} /></div></div>
    <div className="space-y-3 rounded-md border p-3"><div className="flex items-center justify-between"><Label>上游提供商与权重</Label><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setForm({ ...form, upstreams: [...form.upstreams, { provider: '', weight: 0, modelMappings: [] }] })}><Plus className="mr-1 size-3" />添加上游</Button></div>{form.upstreams.map((upstream, index) => <div className="space-y-2 rounded border p-3" key={index}><div className="grid gap-2 md:grid-cols-[1fr_110px_36px]"><select aria-label="上游提供商" disabled={pending} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={upstream.provider} onChange={(event) => updateUpstream(index, { provider: event.target.value })}><option value="">选择提供商...</option>{providerNames.map((name) => <option key={name} value={name}>{name}</option>)}</select><Input aria-label="上游权重" disabled={pending} type="number" min="0" max="100" value={upstream.weight} onChange={(event) => updateUpstream(index, { weight: Number(event.target.value) })} /><Button type="button" variant="ghost" size="icon" disabled={pending || form.upstreams.length === 1} aria-label="删除上游" onClick={() => setForm({ ...form, upstreams: form.upstreams.filter((_, upstreamIndex) => upstreamIndex !== index) })}><Trash2 className="size-4 text-destructive" /></Button></div><MappingEditor value={upstream.modelMappings} onChange={(modelMappings) => updateUpstream(index, { modelMappings })} /></div>)}</div>
    <div className="space-y-3 rounded-md border p-3"><div className="flex items-center justify-between"><Label>请求模型匹配</Label><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setForm({ ...form, modelPredicates: [...form.modelPredicates, { matchType: 'EXACT', matchValue: '' }] })}><Plus className="mr-1 size-3" />添加匹配</Button></div>{form.modelPredicates.map((predicate, index) => <div className="grid gap-2 md:grid-cols-[150px_1fr_36px]" key={index}><select aria-label="模型匹配类型" disabled={pending} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={predicate.matchType} onChange={(event) => setForm({ ...form, modelPredicates: form.modelPredicates.map((item, itemIndex) => itemIndex === index ? { ...item, matchType: event.target.value } : item) })}><option value="EXACT">精确（EXACT）</option><option value="PRE">前缀（PRE）</option></select><Input aria-label="模型匹配值" disabled={pending} value={predicate.matchValue} placeholder="例如 team-chat" onChange={(event) => setForm({ ...form, modelPredicates: form.modelPredicates.map((item, itemIndex) => itemIndex === index ? { ...item, matchValue: event.target.value } : item) })} /><Button type="button" variant="ghost" size="icon" disabled={pending} aria-label="删除模型匹配" onClick={() => setForm({ ...form, modelPredicates: form.modelPredicates.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="size-4 text-destructive" /></Button></div>)}</div>
    <div className="space-y-3 rounded-md border p-3"><div className="flex items-center gap-2"><Input id="route-auth" className="size-4" type="checkbox" checked={form.authConfig.enabled} disabled={pending} onChange={(event) => setForm({ ...form, authConfig: { ...form.authConfig, enabled: event.target.checked } })} /><Label htmlFor="route-auth">启用认证</Label></div>{form.authConfig.enabled && <div className="flex items-center gap-2"><Input id="key-auth" className="size-4" type="checkbox" checked={form.authConfig.allowedCredentialTypes.includes('key-auth')} disabled={pending} onChange={(event) => setForm({ ...form, authConfig: { ...form.authConfig, allowedCredentialTypes: event.target.checked ? ['key-auth'] : [] } })} /><Label htmlFor="key-auth">Key Auth</Label></div>}</div>
    <div><Label>回退配置</Label>{fallbackConfigWritable ? <textarea disabled={pending} className="min-h-28 w-full rounded-md border border-input bg-transparent p-3 font-mono text-sm" value={fallbackJson} onChange={(event) => setFallbackJson(event.target.value)} placeholder={'{\n  "maxRetries": 2\n}'} /> : <p className="mt-2 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">{summarizeFallbackConfig(route?.fallbackConfig)}。当前 Higress Console API 版本仅提供只读摘要。</p>}</div>
    <FormErrors errors={errors} />
  </div><DialogFooter><Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>取消</Button><Button disabled={pending} onClick={submit}>{pending && <Loader2 className="mr-1 size-4 animate-spin" />}{editing ? '保存修改' : '创建路由'}</Button></DialogFooter></DialogContent></Dialog>;
}

export function ModelsSection() {
  const consoleAccess = useHigressConsoleAccess();
  const providersQuery = useModels(consoleAccess.canManage);
  const routesQuery = useAiRoutes(consoleAccess.canManage);
  const { data: managers } = useManagers();
  const { data: workers } = useWorkers();
  const deleteProvider = useDeleteModel();
  const deleteRoute = useDeleteAiRoute();
  const [providerDialog, setProviderDialog] = useState<LlmProviderResponse | null | undefined>(undefined);
  const [routeDialog, setRouteDialog] = useState<AiRoute | null | undefined>(undefined);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'provider' | 'route'; name: string } | null>(null);
  const providers = providersQuery.data ?? [];
  const routes = routesQuery.data ?? [];
  const providerNames = providers.map((provider) => provider.name);
  const modelBindings = buildModelBindings([... (managers ?? []), ...(workers ?? [])].map((agent) => agent.model), routes, providers);
  const providerInUse = deleteTarget?.type === 'provider' ? routes.filter((route) => route.upstreams.some((upstream) => upstream.provider === deleteTarget.name)).map((route) => route.name) : [];
  const deleting = deleteProvider.isPending || deleteRoute.isPending;
  const confirmDelete = () => {
    if (!deleteTarget) return;
    const onSuccess = () => setDeleteTarget(null);
    const onError = () => undefined;
    if (deleteTarget.type === 'provider') deleteProvider.mutate(deleteTarget.name, { onSuccess, onError });
    else deleteRoute.mutate(deleteTarget.name, { onSuccess, onError });
  };
  if (!consoleAccess.canManage) return <div className="space-y-4"><SectionHeader title="Higress Console 管理" description="模型提供商和 AI 路由由外部 Higress Console 管理" /><div className="rounded-lg border border-border/50 bg-muted/30 p-4 text-sm text-muted-foreground">{consoleAccess.isLoading ? '正在检查 Higress Console 状态...' : consoleAccess.reason}</div></div>;
  return <div className="space-y-6">
    <SectionHeader title="AI 网关" description="管理 Higress 提供商、路由、模型别名与 Consumer 凭证" />
    <Card className="glass-card"><CardHeader><CardTitle className="text-base">AI 模型提供商</CardTitle><CardDescription>协议、Token 故障转移、模型映射与公开高级配置</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={deleting} onClick={() => setProviderDialog(null)}><Plus className="mr-1 size-3.5" />添加提供商</Button><span className="text-xs text-muted-foreground">共 {providers.length} 个提供商</span></div><ResourceError error={providersQuery.error} /><ProviderTable loading={providersQuery.isLoading} providers={providers} pending={deleting} onEdit={setProviderDialog} onDelete={(name) => setDeleteTarget({ type: 'provider', name })} /></CardContent></Card>
    <Card className="glass-card"><CardHeader><CardTitle className="text-base">AI 路由</CardTitle><CardDescription>多上游权重、路径与模型匹配、认证和回退策略</CardDescription></CardHeader><CardContent className="space-y-4"><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={deleting || providerNames.length === 0} onClick={() => setRouteDialog(null)}><Plus className="mr-1 size-3.5" />添加路由</Button><span className="text-xs text-muted-foreground">共 {routes.length} 条路由</span></div>{providerNames.length === 0 && <p className="text-sm text-muted-foreground">请先创建至少一个提供商后再添加路由。</p>}<ResourceError error={routesQuery.error} /><RouteTable loading={routesQuery.isLoading} routes={routes} pending={deleting} onEdit={setRouteDialog} onDelete={(name) => setDeleteTarget({ type: 'route', name })} /></CardContent></Card>
    <Card className="glass-card"><CardHeader><CardTitle className="text-base">请求模型别名绑定</CardTitle><CardDescription>Manager 和 Worker 的模型别名将由 Higress 路由解析为具体提供商模型</CardDescription></CardHeader><CardContent><Table><TableHeader><TableRow><TableHead>请求模型别名</TableHead><TableHead>路由</TableHead><TableHead>提供商</TableHead><TableHead>目标模型</TableHead><TableHead>状态</TableHead></TableRow></TableHeader><TableBody>{modelBindings.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">暂无请求模型别名绑定</TableCell></TableRow> : modelBindings.map((binding) => <TableRow key={`${binding.requestModelAlias}-${binding.routeName}-${binding.providerName}`}><TableCell className="font-mono text-xs">{binding.requestModelAlias}</TableCell><TableCell>{binding.routeName || '-'}</TableCell><TableCell>{binding.providerName || '-'}</TableCell><TableCell className="font-mono text-xs">{binding.targetModel || '-'}</TableCell><TableCell><Badge variant={binding.available ? 'default' : 'destructive'} className="text-[10px]">{binding.available ? '可用' : '不可用'}</Badge></TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
    <ConsumerSection />
    <RateLimitSection routes={routes} />
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4"><div className="flex items-start gap-3"><AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-500" /><p className="text-xs text-muted-foreground">模型配置通过 Higress Console API 管理，凭据仅以 Token 数量形式显示。</p></div></div>
    <ProviderDialog key={`provider-${providerDialog?.name ?? 'new'}-${providerDialog !== undefined}`} open={providerDialog !== undefined} provider={providerDialog ?? null} onOpenChange={(open) => !open && setProviderDialog(undefined)} /><RouteDialog key={`route-${routeDialog?.name ?? 'new'}-${routeDialog !== undefined}`} open={routeDialog !== undefined} route={routeDialog ?? null} providerNames={providerNames} fallbackConfigWritable={routes.some((item) => item.fallbackConfigWritable)} onOpenChange={(open) => !open && setRouteDialog(undefined)} />
    <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认删除{deleteTarget?.type === 'provider' ? '提供商' : '路由'}</AlertDialogTitle><AlertDialogDescription>{deleteTarget?.type === 'provider' && providerInUse.length > 0 ? `以下路由仍引用该提供商：${providerInUse.join('、')}。删除后这些路由将失效。` : `将删除 ${deleteTarget?.name ?? ''}，此操作无法撤销。`}</AlertDialogDescription>{(deleteProvider.isError || deleteRoute.isError) && <p className="text-sm text-destructive">{(deleteProvider.error ?? deleteRoute.error)?.message}</p>}</AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel><AlertDialogAction disabled={deleting} onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deleting && <Loader2 className="mr-1 inline size-4 animate-spin" />}删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

function ResourceError({ error }: { error: Error | null }) { return error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">加载失败：{error.message}</p> : null; }

function ProviderTable({ loading, providers, pending, onEdit, onDelete }: { loading: boolean; providers: LlmProviderResponse[]; pending: boolean; onEdit: (_provider: LlmProviderResponse) => void; onDelete: (_name: string) => void }) { return <Table><TableHeader><TableRow><TableHead>名称</TableHead><TableHead>类型</TableHead><TableHead>协议</TableHead><TableHead>Token 数</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{loading ? <LoadingRow /> : providers.length === 0 ? <EmptyRow icon={<Server className="mx-auto mb-2 size-8 text-muted-foreground/50" />} text="暂无 AI 提供商配置" /> : providers.map((provider) => <TableRow key={provider.name}><TableCell className="font-medium"><div className="flex items-center gap-2"><Server className="size-3.5 text-muted-foreground" />{provider.name}</div></TableCell><TableCell><Badge variant="outline" className="text-[10px]">{PROVIDER_TYPES.find((type) => type.value === provider.type)?.label || provider.type}</Badge></TableCell><TableCell className="font-mono text-xs text-muted-foreground">{provider.protocol || 'openai/v1'}</TableCell><TableCell><span className="flex items-center gap-1 text-xs"><Key className="size-3 text-muted-foreground" />{provider.tokenCount} 个</span></TableCell><TableCell className="text-right"><Button variant="ghost" size="icon" title="编辑提供商" aria-label={`编辑 ${provider.name}`} disabled={pending} onClick={() => onEdit(provider)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" title="删除提供商" aria-label={`删除 ${provider.name}`} disabled={pending} onClick={() => onDelete(provider.name)}><Trash2 className="size-4 text-destructive" /></Button></TableCell></TableRow>)}</TableBody></Table>; }

function RouteTable({ loading, routes, pending, onEdit, onDelete }: { loading: boolean; routes: AiRoute[]; pending: boolean; onEdit: (_route: AiRoute) => void; onDelete: (_name: string) => void }) { return <Table><TableHeader><TableRow><TableHead>名称</TableHead><TableHead>路径</TableHead><TableHead>上游提供商</TableHead><TableHead>认证</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{loading ? <LoadingRow /> : routes.length === 0 ? <EmptyRow icon={<Route className="mx-auto mb-2 size-8 text-muted-foreground/50" />} text="暂无 AI 路由" /> : routes.map((route) => <TableRow key={route.name}><TableCell className="font-medium"><div className="flex items-center gap-2"><Route className="size-3.5 text-muted-foreground" />{route.name}</div></TableCell><TableCell className="font-mono text-xs text-muted-foreground">{route.pathPredicate.matchValue}</TableCell><TableCell><div className="flex flex-wrap gap-1">{route.upstreams.map((upstream) => <Badge key={`${route.name}-${upstream.provider}`} variant="secondary" className="text-[10px]">{upstream.provider} ({upstream.weight}%)</Badge>)}</div></TableCell><TableCell>{route.authConfig?.enabled ? <Badge variant="outline" className="text-[10px]">已启用</Badge> : <span className="text-xs text-muted-foreground">未启用</span>}</TableCell><TableCell className="text-right"><Button variant="ghost" size="icon" title="编辑路由" aria-label={`编辑 ${route.name}`} disabled={pending} onClick={() => onEdit(route)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" title="删除路由" aria-label={`删除 ${route.name}`} disabled={pending} onClick={() => onDelete(route.name)}><Trash2 className="size-4 text-destructive" /></Button></TableCell></TableRow>)}</TableBody></Table>; }

function LoadingRow() { return <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />加载中...</TableCell></TableRow>; }
function EmptyRow({ icon, text }: { icon: ReactNode; text: string }) { return <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{icon}{text}</TableCell></TableRow>; }

// ============ Consumer Management ============

function ConsumerSection() {
  const {
    data: consumers,
    isLoading: consumersLoading,
    error: consumersError,
    listUnsupported: consumerListUnsupported,
  } = useConsumers();
  const createConsumer = useCreateConsumer();
  const deleteConsumer = useDeleteConsumer();
  const [showAdd, setShowAdd] = useState(false);
  const [consumerName, setConsumerName] = useState('');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerPendingDeletion, setConsumerPendingDeletion] = useState<string | null>(null);

  const handleCreate = useCallback(async () => {
    if (!consumerName.trim()) return;
    try {
      const created = await createConsumer.mutateAsync({
        name: consumerName.trim(),
        credential_key: consumerKey.trim() || undefined,
      });
      if (created?.api_key) {
        toast.success(`Consumer "${consumerName}" 创建成功，API Key: ${created.api_key}`, { duration: 15000 });
      } else {
        toast.success(`Consumer "${consumerName}" 创建成功`);
      }
      setConsumerName('');
      setConsumerKey('');
      setShowAdd(false);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    }
  }, [consumerName, consumerKey, createConsumer]);

  const handleDelete = useCallback(async () => {
    if (!consumerPendingDeletion) return;
    try {
      await deleteConsumer.mutateAsync(consumerPendingDeletion);
      toast.success('Consumer 已删除');
      setConsumerPendingDeletion(null);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  }, [consumerPendingDeletion, deleteConsumer]);

  return <div className="space-y-3"><div className="flex items-center justify-between"><h3 className="text-sm font-semibold flex items-center gap-2"><Users className="size-4 text-violet-500" />Consumers（认证凭证）</h3><Button variant="outline" size="sm" onClick={() => setShowAdd((v) => !v)}><Plus className="mr-1 size-3.5" />添加 Consumer</Button></div>
    {showAdd && <div className="flex items-end gap-2 p-3 border border-border rounded-lg bg-card/50"><div className="flex-1"><Label className="text-xs">名称</Label><Input value={consumerName} onChange={(e) => setConsumerName(e.target.value)} placeholder="consumer-name" className="h-8 text-sm" /></div><div className="flex-1"><Label className="text-xs">API Key (可选)</Label><Input value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} placeholder="留空自动生成" type="password" className="h-8 text-sm" /></div><Button size="sm" onClick={handleCreate} disabled={!consumerName.trim() || createConsumer.isPending}>{createConsumer.isPending ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : '创建'}</Button><Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>取消</Button></div>}
    {consumerListUnsupported && <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-muted-foreground"><AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" /><p>当前 Controller 版本不支持获取 Consumer 列表（v1.2.0-beta.1 缺少 GET /api/v1/gateway/consumers），仍可创建新 Consumer。</p></div>}
    {consumersError && <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"><AlertTriangle className="size-4 shrink-0 mt-0.5" /><p>Consumer 列表加载失败: {formatErrorMessage(consumersError)}</p></div>}
    <Table><TableHeader><TableRow><TableHead>名称</TableHead><TableHead>凭证</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{consumersLoading ? <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />加载中...</TableCell></TableRow> : !consumersLoading && consumers?.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">暂无 Consumer</TableCell></TableRow> : consumers?.map((consumer) => <TableRow key={consumer.name}><TableCell className="font-medium"><div className="flex items-center gap-2"><Key className="size-3.5 text-muted-foreground" />{consumer.name}</div></TableCell><TableCell>{consumer.status && <Badge variant="outline" className="text-[10px]">{consumer.status}</Badge>}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" aria-label={`删除 ${consumer.name}`} onClick={() => setConsumerPendingDeletion(consumer.name)} disabled={deleteConsumer.isPending}><Trash2 className="size-4 text-destructive" /></Button></TableCell></TableRow>)}</TableBody></Table>
    <AlertDialog open={Boolean(consumerPendingDeletion)} onOpenChange={(open) => !open && !deleteConsumer.isPending && setConsumerPendingDeletion(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认删除 Consumer</AlertDialogTitle><AlertDialogDescription>将删除 {consumerPendingDeletion ?? ''} 的认证凭证。依赖该凭证的调用将无法通过 Higress 认证。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleteConsumer.isPending}>取消</AlertDialogCancel><AlertDialogAction disabled={deleteConsumer.isPending} onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deleteConsumer.isPending && <Loader2 className="mr-1 inline size-4 animate-spin" />}删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

// ============ Rate Limit Plugin Configuration ============

interface RateLimitConfig {
  routeName: string;
  enabled: boolean;
  rps: number;
  rpm: number;
  burst: number;
  perConsumer: boolean;
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
    setConfigs((prev) => prev.map((c, i) => (i === idx ? { ...c, enabled: !c.enabled } : c)));
  }, []);

  const handleUpdateField = useCallback(
    <K extends keyof RateLimitConfig>(idx: number, field: K, value: RateLimitConfig[K]) => {
      setConfigs((prev) => prev.map((c, i) => (i === idx ? { ...c, [field]: value } : c)));
    },
    []
  );

  const handleExportConfig = useCallback(() => {
    const pluginConfigs = configs.filter((c) => c.enabled).map((c) => ({
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

  return <div className="space-y-3">
    <div className="flex items-center justify-between"><h3 className="text-sm font-semibold flex items-center gap-2"><Gauge className="size-4 text-amber-500" />限流策略 (Rate Limit)</h3><div className="flex items-center gap-2">{configs.length > 0 && <Button variant="outline" size="sm" className="h-7 text-xs" onClick={handleExportConfig}><Save className="mr-1 size-3" />导出配置</Button>}<Button variant="outline" size="sm" className="h-7 text-xs" onClick={() => setShowAdd((v) => !v)}><Plus className="mr-1 size-3" />添加限流规则</Button></div></div>
    {showAdd && <div className="border border-border rounded-lg p-4 space-y-3 bg-card/50"><div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"><div><label className="text-xs text-muted-foreground">目标路由 *</label><select className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={newConfig.routeName} onChange={(e) => setNewConfig({ ...newConfig, routeName: e.target.value })}><option value="">选择路由...</option>{routes?.map((r) => <option key={r.name} value={r.name}>{r.name}</option>)}</select></div><div><label className="text-xs text-muted-foreground">RPS (每秒请求数)</label><input type="number" className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={newConfig.rps} onChange={(e) => setNewConfig({ ...newConfig, rps: parseInt(e.target.value) || 0 })} min={0} /></div><div><label className="text-xs text-muted-foreground">RPM (每分钟请求数)</label><input type="number" className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={newConfig.rpm} onChange={(e) => setNewConfig({ ...newConfig, rpm: parseInt(e.target.value) || 0 })} min={0} /></div><div><label className="text-xs text-muted-foreground">突发容量</label><input type="number" className="flex h-8 w-full rounded-md border border-input bg-transparent px-2 text-sm" value={newConfig.burst} onChange={(e) => setNewConfig({ ...newConfig, burst: parseInt(e.target.value) || 0 })} min={0} /></div></div><div className="flex items-center gap-3"><label className="flex items-center gap-2 text-xs cursor-pointer"><input type="checkbox" checked={newConfig.perConsumer} onChange={(e) => setNewConfig({ ...newConfig, perConsumer: e.target.checked })} className="rounded" />按 Consumer 限流（不同 Consumer 独立计数）</label></div><div className="flex items-center gap-2"><Button size="sm" onClick={handleAdd} disabled={!newConfig.routeName}>添加</Button><Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>取消</Button></div></div>}
    {configs.length === 0 && !showAdd && <p className="text-xs text-muted-foreground text-center py-4">暂无限流规则。点击「添加限流规则」为 AI 路由配置请求频率限制。</p>}
    {configs.map((config, idx) => <div key={`${config.routeName}-${idx}`} className={`flex items-center gap-3 p-3 rounded-lg border ${config.enabled ? 'border-border bg-card/50' : 'border-border/50 bg-muted/20 opacity-60'}`}><button onClick={() => handleToggle(idx)}>{config.enabled ? <ToggleRight className="size-5 text-emerald-500" /> : <ToggleLeft className="size-5 text-gray-400" />}</button><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><Route className="size-3.5 text-muted-foreground" /><span className="text-xs font-medium">{config.routeName}</span>{config.perConsumer && <Badge variant="secondary" className="text-[9px]">按 Consumer</Badge>}</div><div className="flex items-center gap-3 mt-1 text-[10px] text-muted-foreground">{config.rps > 0 && <span className="flex items-center gap-1"><Zap className="size-3" />{config.rps} req/s</span>}{config.rpm > 0 && <span className="flex items-center gap-1"><Clock className="size-3" />{config.rpm} req/min</span>}{config.burst > 0 && <span>突发: {config.burst}</span>}</div></div><input type="number" className="w-16 h-7 rounded border border-input bg-transparent px-1.5 text-xs text-center" value={config.rps} onChange={(e) => handleUpdateField(idx, 'rps', parseInt(e.target.value) || 0)} title="RPS" /><span className="text-[10px] text-muted-foreground">req/s</span><Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleRemove(idx)}><Trash2 className="size-3.5 text-destructive" /></Button></div>)}
    {configs.length > 0 && <div className="border border-border/50 rounded-lg p-3 bg-muted/20"><div className="flex items-start gap-2"><AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" /><div className="text-[10px] text-muted-foreground space-y-0.5"><p>限流配置导出后需通过 Higress Console API 或 kubectl 应用到网关。</p><p>配置格式: Higress <code>wasm-rate-limit</code> 插件，支持 per-route 和 per-consumer 限流。</p></div></div></div>}
  </div>;
}
