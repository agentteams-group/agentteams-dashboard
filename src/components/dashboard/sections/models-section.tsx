'use client';

import { useState, type ReactNode } from 'react';
import { AlertTriangle, Key, Loader2, Pencil, Plus, Route, Server, Trash2 } from 'lucide-react';
import { SectionHeader } from '@/components/dashboard/section-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
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
  return <div className="space-y-8">
    <div className="space-y-4"><SectionHeader title="AI 模型提供商" description="管理提供商协议、Token 故障转移、模型映射与公开高级配置" /><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={deleting} onClick={() => setProviderDialog(null)}><Plus className="mr-1 size-3.5" />添加提供商</Button><span className="text-xs text-muted-foreground">共 {providers.length} 个提供商</span></div><ResourceError error={providersQuery.error} /><ProviderTable loading={providersQuery.isLoading} providers={providers} pending={deleting} onEdit={setProviderDialog} onDelete={(name) => setDeleteTarget({ type: 'provider', name })} /></div>
    <div className="space-y-4"><SectionHeader title="AI 路由" description="配置多上游、权重、路径和模型匹配、认证与回退策略" /><div className="flex items-center gap-2"><Button variant="outline" size="sm" disabled={deleting || providerNames.length === 0} onClick={() => setRouteDialog(null)}><Plus className="mr-1 size-3.5" />添加路由</Button><span className="text-xs text-muted-foreground">共 {routes.length} 条路由</span></div>{providerNames.length === 0 && <p className="text-sm text-muted-foreground">请先创建至少一个提供商后再添加路由。</p>}<ResourceError error={routesQuery.error} /><RouteTable loading={routesQuery.isLoading} routes={routes} pending={deleting} onEdit={setRouteDialog} onDelete={(name) => setDeleteTarget({ type: 'route', name })} /></div>
    <div className="space-y-4"><SectionHeader title="请求模型别名绑定" description="Manager 和 Worker 使用的模型别名将由 Higress 路由解析到具体提供商模型" /><Table><TableHeader><TableRow><TableHead>请求模型别名</TableHead><TableHead>路由</TableHead><TableHead>提供商</TableHead><TableHead>目标模型</TableHead><TableHead>状态</TableHead></TableRow></TableHeader><TableBody>{modelBindings.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">暂无请求模型别名绑定</TableCell></TableRow> : modelBindings.map((binding) => <TableRow key={`${binding.requestModelAlias}-${binding.routeName}-${binding.providerName}`}><TableCell className="font-mono text-xs">{binding.requestModelAlias}</TableCell><TableCell>{binding.routeName || '-'}</TableCell><TableCell>{binding.providerName || '-'}</TableCell><TableCell className="font-mono text-xs">{binding.targetModel || '-'}</TableCell><TableCell><Badge variant={binding.available ? 'default' : 'destructive'} className="text-[10px]">{binding.available ? '可用' : '不可用'}</Badge></TableCell></TableRow>)}</TableBody></Table></div>
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
