'use client';

import { OverflowText } from '@/components/dashboard/overflow-text';
import { useState, useCallback, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeftRight, ArrowRight, ChevronDown, ChevronRight, Clock, Gauge, Globe, Info, Key, Link2, Loader2, Monitor, Pencil, Play, Plus, Route, Save, Server, ToggleLeft, ToggleRight, Trash2, Users, Zap } from 'lucide-react';
import { SectionHeader } from '@/components/dashboard/section-header';
import { InfoTip } from '@/components/dashboard/info-tip';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Combobox } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
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
import { useConsumers } from '@/hooks/use-agentteams-consumers';
import { useCreateConsumer, useDeleteConsumer, useBindConsumer } from '@/hooks/use-agentteams-mutations';
import {
  parseFallbackConfig,
  PROVIDER_BASE_URLS,
  PROVIDER_TYPES,
  modelProviderType,
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
import { useHigressConsoleAccess } from '@/hooks/use-higress-console-access';
import { useGatewayRouteCatalog } from '@/hooks/use-gateway-route-catalog';
import { useInfrastructure } from '@/hooks/use-agentteams-infrastructure';
import type { HigressStatus } from '@/lib/agentteams-api';
import { formatErrorMessage } from '@/lib/api-error';
import { toast } from 'sonner';
import { ManagerModelSetup } from './manager-model-setup';
import { MODEL_PRESET_NOTES, providerModelPresets } from '@/lib/model-catalog';
import { commonReasoningEfforts, MODEL_CAPABILITIES, readModelRequestParameters, REASONING_EFFORT_LABELS } from '@/lib/model-parameters';
import type { ModelProbeInput, ModelProbeResult } from '@/lib/model-connection-probe';
import { apiUrl } from '@/lib/api-base';

const newProviderForm = (): ProviderForm => ({
  name: '', type: 'openai', protocol: 'openai/v1', baseUrl: PROVIDER_BASE_URLS.openai, tokens: [], modelMappings: [{ pattern: '', targetModel: '' }], pathPrefix: '/v1',
});

const newRouteForm = (providerNames: string[] = [], pathPrefix = '/v1'): RouteForm => ({
  name: '',
  pathPredicate: { matchType: 'PRE', matchValue: pathPrefix },
  // With a single provider the upstream is preselected so creating a route
  // after adding the first provider is a one-click submission.
  upstreams: providerNames.length === 1
    ? [{ provider: providerNames[0], weight: 100, modelMappings: [] }]
    : [{ provider: '', weight: 100, modelMappings: [] }],
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
  let baseUrl = typeof rawConfigs.openaiCustomUrl === 'string' ? rawConfigs.openaiCustomUrl : '';
  // Higress separates a custom URL's port into openaiCustomServicePort.
  if (baseUrl && typeof rawConfigs.openaiCustomServicePort === 'number') {
    try {
      const url = new URL(baseUrl);
      if (!url.port) url.port = String(rawConfigs.openaiCustomServicePort);
      baseUrl = url.toString();
    } catch { /* Preserve the original value for the form to display. */ }
  }
  return {
    name: provider.name,
    type: modelProviderType(provider),
    protocol: provider.protocol === 'original' ? 'original' : 'openai/v1',
    tokens: [],
    baseUrl,
    pathPrefix: typeof rawConfigs.pathPrefix === 'string' ? rawConfigs.pathPrefix : '/v1',
    tokenFailoverConfig: provider.tokenFailoverConfig,
    modelMappings: mappingRules(rawConfigs.modelMapping),
    originalRawConfigs: rawConfigs,
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
    authConfig: route.authConfig
      ? {
          enabled: Boolean(route.authConfig.enabled),
          allowedCredentialTypes: Array.isArray(route.authConfig.allowedCredentialTypes)
            ? [...route.authConfig.allowedCredentialTypes]
            : [],
          ...(Array.isArray(route.authConfig.allowedConsumers) && route.authConfig.allowedConsumers.length > 0
            ? { allowedConsumers: [...route.authConfig.allowedConsumers] }
            : {}),
        }
      : { enabled: true, allowedCredentialTypes: ['key-auth'] },
    fallbackConfig: route.fallbackConfig,
  };
}

function FormErrors({ errors }: { errors: string[] }) {
  return errors.length > 0 ? <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">{errors.map((error) => <p key={error}>{error}</p>)}</div> : null;
}

function MappingEditor({ value, onChange, label, modelOptions, simple = false, onTest, canTest }: { value: ModelMappingRule[]; onChange: (_value: ModelMappingRule[]) => void; label?: string; modelOptions?: readonly string[]; simple?: boolean; onTest?: (_model: string) => void; canTest?: boolean }) {
  if (simple) return <div className="space-y-3">
    <div className="flex items-center justify-between gap-2"><Label>接入模型</Label><Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { pattern: '', targetModel: '' }])}><Plus className="mr-1 size-3" />添加模型</Button></div>
    {value.length === 0 ? <p className="text-xs text-muted-foreground">添加要使用的模型 ID，支持搜索候选和手动输入。</p> : null}
    {value.map((mapping, index) => {
      const capability = MODEL_CAPABILITIES[mapping.targetModel];
      const update = (change: Partial<ModelMappingRule>) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item));
      return <div key={index} className="space-y-2 rounded-md border p-3">
        <Label htmlFor={`connection-model-${index}`}>模型 ID</Label>
        <div className="flex min-w-0 items-center gap-2"><Combobox id={`connection-model-${index}`} portal ariaLabel="模型 ID" value={mapping.targetModel} options={modelOptions ?? []} placeholder="搜索或输入模型 ID" className="min-w-0 flex-1" onChange={(targetModel) => update({ targetModel, ...(!mapping.pattern || mapping.pattern === mapping.targetModel ? { pattern: targetModel } : {}) })} />{onTest ? <Button type="button" variant="outline" size="sm" aria-label={`测试模型 ${mapping.targetModel || '未填写'}`} disabled={!canTest || !mapping.targetModel.trim()} onClick={() => onTest(mapping.targetModel.trim())}><Play className="mr-1 size-3.5" />测试</Button> : null}<Button type="button" variant="ghost" size="icon" aria-label="删除接入模型" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-4 text-destructive" /></Button></div>
        {capability ? <div className="flex items-center gap-1"><p className="text-xs leading-5 text-muted-foreground">上下文窗口：{capability.contextWindow.toLocaleString('en-US')} Token{capability.maxOutputTokens || capability.outputLabel ? ` · 最大输出：${capability.maxOutputTokens?.toLocaleString('en-US') ?? capability.outputLabel} Token` : ''}</p><InfoTip label="模型容量说明">官方参考，实际以接入平台为准。上下文窗口是模型可处理的总容量，不会修改 Agent 的历史保留或压缩设置。</InfoTip></div> : mapping.targetModel ? <p className="text-xs text-muted-foreground">容量信息请以接入平台文档为准。</p> : null}
        {MODEL_PRESET_NOTES[mapping.targetModel] ? mapping.targetModel.startsWith('MiniMax-') ? <InfoTip label="MiniMax 接入说明">{MODEL_PRESET_NOTES[mapping.targetModel]}</InfoTip> : <p className="text-xs leading-5 text-muted-foreground break-words">{MODEL_PRESET_NOTES[mapping.targetModel]}</p> : null}
        <details open={Boolean(mapping.pattern && mapping.pattern !== mapping.targetModel) || undefined}><summary className="cursor-pointer text-xs text-muted-foreground">调用别名（可选）</summary><div className="mt-2 space-y-1"><Label htmlFor={`connection-alias-${index}`}>调用别名</Label><Input id={`connection-alias-${index}`} aria-label="调用别名" value={mapping.pattern} placeholder="默认与模型 ID 相同" onChange={(event) => update({ pattern: event.target.value })} /><p className="text-xs text-muted-foreground">Agent 使用的调用名称。多个连接使用相同模型时，可设置不同别名。</p></div></details>
      </div>;
    })}
  </div>;
  return <div className="space-y-2">
    <div className="flex items-center justify-between">
      <div>
        <div className="flex items-center gap-1">
          <Label>{label ?? '模型映射'}</Label>
          <InfoTip label="模型映射填写说明">左边填请求模型别名（Worker 中选择的名称），右边填模型 ID。</InfoTip>
        </div>
      </div>
      <Button type="button" variant="outline" size="sm" onClick={() => onChange([...value, { pattern: '', targetModel: '' }])}><Plus className="mr-1 size-3" />添加映射</Button>
    </div>
    {value.length > 0 && (
      <div className="hidden grid-cols-[1fr_auto_1fr] gap-2 text-xs text-muted-foreground px-1 md:grid">
        <span>请求模型别名</span>
        <span className="w-6" />
        <span>模型 ID</span>
      </div>
    )}
    {value.map((mapping, index) => <div key={index}><div className="flex items-center gap-2">
      <Input aria-label="请求模型别名" value={mapping.pattern} placeholder="例: deepseek-chat" className="flex-1" onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, pattern: event.target.value } : item))} />
      <ArrowRight className="size-4 text-muted-foreground shrink-0" />
      {modelOptions ? <Combobox portal ariaLabel="模型 ID" value={mapping.targetModel} options={modelOptions} placeholder="选择或输入模型" className="flex-1" onChange={(targetModel) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, targetModel } : item))} /> : <Input aria-label="模型 ID" value={mapping.targetModel} placeholder="例: deepseek-chat" className="flex-1" onChange={(event) => onChange(value.map((item, itemIndex) => itemIndex === index ? { ...item, targetModel: event.target.value } : item))} />}
      <Button type="button" variant="ghost" size="icon" aria-label="删除模型映射" onClick={() => onChange(value.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-4 text-destructive" /></Button>
    </div>{modelOptions && MODEL_PRESET_NOTES[mapping.targetModel] ? <p className="mt-1 text-xs leading-5 text-muted-foreground break-words">{MODEL_PRESET_NOTES[mapping.targetModel]}</p> : null}</div>)}
  </div>;
}

async function probeModelConnection(input: ModelProbeInput): Promise<ModelProbeResult> {
  try {
    const response = await fetch(apiUrl('/api/agentteams/models/probe'), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) });
    const result = await response.json().catch(() => null);
    return result && typeof result.success === 'boolean' && typeof result.message === 'string'
      ? result : { success: false, message: typeof result?.error === 'string' ? result.error : `连接测试失败（HTTP ${response.status}）` };
  } catch {
    return { success: false, message: '无法完成连接测试，请检查网络后重试' };
  }
}

function ModelProbeStatus({ result }: { result: ModelProbeResult | null }) {
  return result ? <div role="status" className={'flex items-start gap-2 rounded-md border p-3 text-xs leading-5 ' + (result.success ? 'border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-400' : 'border-destructive/30 bg-destructive/5 text-destructive')}>
    {result.success ? <Zap className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
    <div className="min-w-0 break-words"><p>{result.message}</p>{result.model || result.latencyMs !== undefined ? <p className="text-muted-foreground">{result.model}{result.latencyMs !== undefined ? ` · ${result.latencyMs} ms` : ''}</p> : null}</div>
  </div> : null;
}

function ConnectionTestDialog({ provider, onClose }: { provider: LlmProviderResponse; onClose: () => void }) {
  const models = [...new Set(mappingRules(provider.rawConfigs?.modelMapping).map((mapping) => mapping.targetModel).filter(Boolean))];
  const [model, setModel] = useState(models[0] ?? '');
  const [testing, setTesting] = useState(false);
  const [result, setResult] = useState<ModelProbeResult | null>(null);
  return <Dialog open onOpenChange={(open) => !open && onClose()}><DialogContent className="max-w-[95vw] sm:max-w-md"><DialogHeader><DialogTitle>测试连接 - {provider.name}</DialogTitle><DialogDescription>使用已保存的 API 地址和密钥，直连所选模型进行一次短调用。</DialogDescription></DialogHeader>
    <div className="min-w-0 space-y-3 py-2"><Label htmlFor="saved-probe-model">模型 ID</Label><Combobox id="saved-probe-model" portal ariaLabel="测试模型 ID" value={model} options={models} disabled={testing} placeholder="选择或输入要测试的模型 ID" onChange={(next) => { setModel(next); setResult(null); }} />
      <p className="text-xs leading-5 text-muted-foreground">测试输出预算最多 256 Token，可能产生少量费用；不验证 Agent 授权或工具调用能力。</p>
      {testing ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />正在调用模型，最长等待 30 秒…</p> : <ModelProbeStatus result={result} />}
    </div><DialogFooter><Button variant="outline" onClick={onClose}>关闭</Button><Button disabled={testing || !model.trim()} onClick={async () => { setTesting(true); setResult(null); const next = await probeModelConnection({ providerName: provider.name, model: model.trim() }); setResult(next); setTesting(false); }}>{testing ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : <Play className="mr-1 size-3.5" />}{testing ? '测试中…' : '开始测试'}</Button></DialogFooter>
  </DialogContent></Dialog>;
}

function ProviderDialog({ open, provider, onOpenChange }: { open: boolean; provider: LlmProviderResponse | null; onOpenChange: (_open: boolean) => void }) {
  const create = useCreateModel();
  const update = useUpdateModel();
  const createRoute = useCreateAiRoute();
  const updateRoute = useUpdateAiRoute();
  const { data: routes } = useAiRoutes();
  const [form, setForm] = useState<ProviderForm>(() => provider ? providerToForm(provider) : newProviderForm());
  const [tokenInput, setTokenInput] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ModelProbeResult | null>(null);
  const editing = Boolean(provider);
  const pending = create.isPending || update.isPending;
  const savedForm = provider ? providerToForm(provider) : null;
  const savedEndpointUnchanged = Boolean(savedForm && form.type === savedForm.type && form.protocol === savedForm.protocol && (form.baseUrl ?? '').trim() === (savedForm.baseUrl ?? '').trim());
  const canTest = Boolean(tokenInput.trim() || (provider?.tokenCount && savedEndpointUnchanged)) && !testing && !pending;

  // After creating a provider, wire it into an auto route so Manager/Worker
  // forms can immediately select the configured model aliases. Skipped when the
  // provider is already referenced by a route or when editing, or when no model
  // mappings are configured (empty-predicate routes would match all aliases and
  // cause binding table noise).
  const autoWireProviderRoute = (providerName: string, modelMappings: ModelMappingRule[]) => {
    const routeName = `agentteams-${providerName}`;
    const existing = (routes ?? []).find((route) => route.name === routeName && route.upstreams.length === 1 && route.upstreams[0].provider === providerName);
    if (!existing && (routes ?? []).some((route) => route.upstreams.some((upstream) => upstream.provider === providerName))) return;
    if (modelMappings.length === 0) {
      toast.info(`模型连接 ${providerName} 已创建，添加模型和路由后即可供 Agent 使用。`);
      return;
    }
    const modelPredicates = modelMappings
      .map((mapping) => ({ matchType: 'EXACT' as const, matchValue: mapping.pattern.trim() }))
      .filter((predicate) => predicate.matchValue && !predicate.matchValue.includes('*') && !predicate.matchValue.startsWith('~'));
    if (existing) {
      updateRoute.mutate({ name: routeName, data: {
        ...existing,
        modelPredicates: modelPredicates.map((predicate) => ({ ...predicate, matchType: 'EQUAL' })),
        upstreams: [{ ...existing.upstreams[0], modelMapping: Object.fromEntries(modelMappings.map((mapping) => [mapping.pattern.trim(), mapping.targetModel.trim()])) }],
      } }, { onError: (error) => toast.error(`连接已保存，但模型路由同步失败：${error.message}。请在高级路由配置中检查。`) });
      return;
    }
    createRoute.mutate(serializeRouteForm({
      name: routeName,
      pathPredicate: { matchType: 'PRE', matchValue: form.pathPrefix || '/v1' },
      upstreams: [{ provider: providerName, weight: 100, modelMappings }],
      modelPredicates,
      authConfig: { enabled: true, allowedCredentialTypes: ['key-auth'] },
    }), {
      onSuccess: () => toast.success(`已自动创建路由 ${routeName}，可在 Manager/Worker 中直接选择模型`),
      onError: (error) => toast.error(`服务商已创建，但自动接入路由失败：${error.message}。可手动创建路由。`),
    });
  };

  const handleTest = async (model: string) => {
    setTestResult(null);
    const token = tokenInput.split(',')[0]?.trim() || '';
    setTesting(true);
    const result = await probeModelConnection(token ? { model, type: form.type, protocol: form.protocol, token, baseUrl: form.baseUrl || undefined } : { model, providerName: provider?.name });
    setTestResult(result);
    setTesting(false);
  };

  const submit = () => {
    const tokens = tokenInput.split(',').map((token) => token.trim()).filter(Boolean);
    const next = { ...form, tokens: tokens.length > 0 ? tokens : form.tokens, modelMappings: form.modelMappings.filter((mapping) => mapping.pattern.trim() || mapping.targetModel.trim()).map((mapping) => ({ ...mapping, pattern: mapping.pattern.trim() || mapping.targetModel.trim() })) };
    const nextErrors = validateProviderForm(next, editing);
    if (nextErrors.length > 0) return setErrors(nextErrors);
    const onSuccess = () => { onOpenChange(false); autoWireProviderRoute(next.name, next.modelMappings); };
    if (provider) update.mutate({ name: provider.name, data: serializeProviderForm(next, true) }, { onSuccess, onError: (error) => setErrors([error.message]) });
    else {
      const payload = serializeProviderForm(next) as Parameters<typeof create.mutate>[0];
      create.mutate(payload, { onSuccess, onError: (error) => setErrors([error.message]) });
    }
  };

  const failover = form.tokenFailoverConfig ?? { enabled: false, failureThreshold: 1, successThreshold: 1, healthCheckInterval: 30, healthCheckModel: '' };
  const modelOptions = providerModelPresets(form.type);
  const modelIds = form.modelMappings.map((mapping) => mapping.targetModel.trim()).filter(Boolean);
  const parameters = form.requestParameters ?? readModelRequestParameters(form.originalRawConfigs?.customSettings, modelIds);
  const efforts = commonReasoningEfforts(modelIds);
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[90vh] max-w-[95vw] overflow-y-auto sm:max-w-2xl">
      <DialogHeader>
        <DialogTitle>{editing ? '编辑模型连接 - ' + provider?.name : '新增模型连接'}</DialogTitle>
        <DialogDescription>保存 API 地址和密钥，再添加要使用的模型 ID。</DialogDescription>
      </DialogHeader>
      <fieldset disabled={pending || testing} className="min-w-0 space-y-4 py-2">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="connection-name">连接名称 *</Label>
            <Input id="connection-name" disabled={editing} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如 my-minimax" />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="provider-type">厂商／平台 *</Label>
            <Combobox id="provider-type" portal allowCustom={false} ariaLabel="厂商／平台" value={PROVIDER_TYPES.find((type) => type.value === form.type)?.label ?? form.type} options={PROVIDER_TYPES.map((type) => type.label)} placeholder="搜索或选择厂商／平台" onChange={(label) => {
              const type = PROVIDER_TYPES.find((item) => item.label === label);
              if (type && type.value !== form.type) {
                setForm({ ...form, type: type.value, baseUrl: PROVIDER_BASE_URLS[type.value] ?? '', protocol: 'openai/v1' });
                setTestResult(null);
              }
            }} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="connection-base-url">API 地址（Base URL）</Label>
          <Input id="connection-base-url" value={form.baseUrl ?? ''} onChange={(event) => { setForm({ ...form, baseUrl: event.target.value }); setTestResult(null); }} placeholder={PROVIDER_BASE_URLS[form.type] ?? 'https://api.example.com/v1'} />
          {form.type === 'minimax' ? <p className="text-xs leading-5 text-muted-foreground break-words">API Key 需匹配所属站点：在 platform.minimax.io 创建的 Key 使用 https://api.minimax.io/v1；国内站 Key 使用 https://api.minimax.cn/v1。</p> : null}
          <p className="text-xs leading-5 text-muted-foreground">无需追加 /chat/completions。留空使用厂商默认地址；自定义地址须兼容 OpenAI。</p>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="connection-api-key">{editing ? 'API Key（留空保留已保存密钥）' : 'API Key *'}</Label>
          <div className="flex flex-wrap gap-2">
            <Input id="connection-api-key" type="password" autoComplete="off" value={tokenInput} onChange={(event) => { setTokenInput(event.target.value); setTestResult(null); }} className="min-w-0 flex-1" placeholder="输入 API Key" />
          </div>
          <p className="text-xs leading-5 text-muted-foreground">{editing ? '当前已保存 ' + (provider?.tokenCount ?? 0) + ' 个密钥。' : ''}多个密钥用英文逗号分隔，测试使用第一个密钥。</p>
        </div>
        <MappingEditor simple value={form.modelMappings} modelOptions={modelOptions} onTest={handleTest} canTest={canTest} onChange={(modelMappings) => { setForm({ ...form, modelMappings }); setTestResult(null); }} />
        {editing && !tokenInput.trim() && !savedEndpointUnchanged ? <p className="text-xs text-muted-foreground">地址或厂商已修改，请先保存连接或输入新 API Key 后测试。</p> : <p className="text-xs leading-5 text-muted-foreground">选择模型后可点「测试」直连调用，输出预算最多 256 Token，可能产生少量费用。Agent 授权和工具调用需另外验证。</p>}
        {testing ? <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />正在调用模型，最长等待 30 秒…</p> : <ModelProbeStatus result={testResult} />}
        <details className="rounded-md border p-3" open={Boolean(form.requestParameters || (Array.isArray(form.originalRawConfigs?.customSettings) && form.originalRawConfigs.customSettings.length)) || undefined}>
          <summary className="cursor-pointer text-sm font-medium">调用参数（可选）</summary>
          <div className="mt-3 space-y-3">
            <p className="text-xs leading-5 text-muted-foreground">留空沿用默认值；设置后覆盖此连接下经网关转发的模型请求参数。直连模型的 Agent 不受此处控制；不同参数请分别创建连接。</p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="connection-output-tokens">输出 Token 上限</Label>
                <Input id="connection-output-tokens" type="number" min="1" step="1" disabled={form.protocol !== 'openai/v1'} value={parameters.maxTokens} placeholder="留空沿用默认值" onChange={(event) => setForm({ ...form, requestParameters: { ...parameters, maxTokens: event.target.value } })} />
                <p className="text-xs leading-5 text-muted-foreground">单次生成的输出预算，不是上下文窗口。部分模型的思考内容也计入该预算；Token 不等于字数。</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="connection-reasoning-effort">思考强度</Label>
                <select id="connection-reasoning-effort" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" disabled={form.protocol !== 'openai/v1' || (!efforts.length && !parameters.reasoningEffort)} value={parameters.reasoningEffort} onChange={(event) => setForm({ ...form, requestParameters: { ...parameters, reasoningEffort: event.target.value } })}>
                  <option value="">跟随模型默认</option>
                  {efforts.map((effort) => <option key={effort} value={effort}>{REASONING_EFFORT_LABELS[effort] ?? effort}</option>)}
                  {parameters.reasoningEffort && !efforts.includes(parameters.reasoningEffort) ? <option value={parameters.reasoningEffort}>{parameters.reasoningEffort}（已保存，待确认）</option> : null}
                </select>
                <p className="text-xs leading-5 text-muted-foreground">{efforts.length ? '仅展示所选模型共同支持的档位。更高通常需要更多时间和 Token。' : '请先选择已核实支持思考强度的模型；未知型号保持默认，不猜测可用档位。'}</p>
              </div>
            </div>
            <details><summary className="cursor-pointer text-xs text-muted-foreground">输出参数兼容设置</summary><div className="mt-2 space-y-1.5">
              <Label htmlFor="connection-output-field">输出 Token 参数名</Label>
              <select id="connection-output-field" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={parameters.outputTokenParameter} disabled={form.protocol !== 'openai/v1'} onChange={(event) => setForm({ ...form, requestParameters: { ...parameters, outputTokenParameter: event.target.value as typeof parameters.outputTokenParameter } })}>
                <option value="max_tokens">max_tokens（多数兼容接口）</option><option value="max_completion_tokens">max_completion_tokens（OpenAI 推理模型）</option>
              </select>
              <p className="text-xs text-muted-foreground">默认根据模型 ID 选择；自定义服务请以服务文档为准。</p>
            </div></details>
            {form.protocol !== 'openai/v1' ? <p className="text-xs text-muted-foreground">当前原生协议暂不提供统一调用参数，请沿用模型默认值。</p> : null}
          </div>
        </details>
        <details className="rounded-md border p-3">
          <summary className="cursor-pointer text-sm font-medium">高级设置</summary>
          <div className="mt-3 space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5"><Label htmlFor="connection-protocol">请求协议</Label><select id="connection-protocol" className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={form.protocol} onChange={(event) => { setForm({ ...form, protocol: event.target.value as ProviderForm['protocol'] }); setTestResult(null); }}><option value="openai/v1">OpenAI 兼容（默认）</option><option value="original">厂商原生</option></select></div>
              <div className="space-y-1.5"><Label htmlFor="connection-path">网关路径前缀</Label><Input id="connection-path" value={form.pathPrefix || '/v1'} onChange={(event) => setForm({ ...form, pathPrefix: event.target.value })} placeholder="/v1" /></div>
            </div>
            <div className="flex items-center gap-2"><Input id="provider-failover" className="size-4" type="checkbox" checked={failover.enabled} onChange={(event) => setForm({ ...form, tokenFailoverConfig: { ...failover, enabled: event.target.checked } })} /><Label htmlFor="provider-failover">启用 API Key 故障转移</Label></div>
            {failover.enabled ? <div className="grid gap-3 sm:grid-cols-2">
              <div><Label htmlFor="connection-failure-threshold">失败阈值</Label><Input id="connection-failure-threshold" type="number" min="1" value={failover.failureThreshold} onChange={(event) => setForm({ ...form, tokenFailoverConfig: { ...failover, failureThreshold: Number(event.target.value) } })} /></div>
              <div><Label htmlFor="connection-success-threshold">成功阈值</Label><Input id="connection-success-threshold" type="number" min="1" value={failover.successThreshold} onChange={(event) => setForm({ ...form, tokenFailoverConfig: { ...failover, successThreshold: Number(event.target.value) } })} /></div>
              <div><Label htmlFor="connection-health-interval">检查间隔（秒）</Label><Input id="connection-health-interval" type="number" min="1" value={failover.healthCheckInterval} onChange={(event) => setForm({ ...form, tokenFailoverConfig: { ...failover, healthCheckInterval: Number(event.target.value) } })} /></div>
              <div><Label htmlFor="connection-health-model">健康检查模型 ID</Label><Input id="connection-health-model" value={failover.healthCheckModel} onChange={(event) => setForm({ ...form, tokenFailoverConfig: { ...failover, healthCheckModel: event.target.value } })} /></div>
            </div> : null}
          </div>
        </details>
        <FormErrors errors={errors} />
      </fieldset>
      <DialogFooter><Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>取消</Button><Button disabled={pending || testing} onClick={submit}>{pending ? <Loader2 className="mr-1 size-4 animate-spin" /> : null}{editing ? '保存修改' : '创建连接'}</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function RouteDialog({ open, route, providerNames, fallbackConfigWritable, onOpenChange }: { open: boolean; route: AiRoute | null; providerNames: string[]; fallbackConfigWritable: boolean; onOpenChange: (_open: boolean) => void }) {
  const create = useCreateAiRoute();
  const update = useUpdateAiRoute();
  const [form, setForm] = useState<RouteForm>(() => route ? routeToForm(route) : newRouteForm(providerNames));
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
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] max-w-[95vw] overflow-y-auto sm:max-w-4xl"><DialogHeader><DialogTitle>{editing ? `编辑路由 - ${route?.name}` : '创建 AI 路由'}</DialogTitle><DialogDescription>路由决定请求模型别名如何匹配到上游模型连接。每个上游可配置独立的模型映射。</DialogDescription></DialogHeader><div className="space-y-4 py-2">
    <div className="grid gap-3 md:grid-cols-3"><div><Label>路由名称 *</Label><Input disabled={editing || pending} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} placeholder="例如 agentteams-ark" /></div><div><Label>路径匹配类型</Label><select disabled={pending} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value="PRE"><option value="PRE">前缀（PRE）</option></select></div><div><Label>路径匹配 *</Label><Input disabled={pending} value={form.pathPredicate.matchValue} onChange={(event) => setForm({ ...form, pathPredicate: { ...form.pathPredicate, matchValue: event.target.value } })} /></div></div>
    <div className="space-y-3 rounded-md border p-3"><div className="flex items-center justify-between"><div className="flex items-center gap-1"><Label>上游模型连接与权重</Label><InfoTip label="上游权重说明">选择模型连接并设置流量权重。多上游时权重总和必须为 100。</InfoTip></div><Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setForm({ ...form, upstreams: [...form.upstreams, { provider: '', weight: 0, modelMappings: [] }] })}><Plus className="mr-1 size-3" />添加上游</Button></div>{form.upstreams.map((upstream, index) => { const selectedByOthers = new Set(form.upstreams.filter((_, upstreamIndex) => upstreamIndex !== index).map((item) => item.provider).filter(Boolean)); return <div className="space-y-2 rounded border p-3" key={index}><div className="grid gap-2 md:grid-cols-[1fr_110px_36px]"><select aria-label="上游模型连接" disabled={pending} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={upstream.provider} onChange={(event) => updateUpstream(index, { provider: event.target.value })}><option value="">选择模型连接...</option>{providerNames.map((name) => <option key={name} value={name} disabled={selectedByOthers.has(name)}>{name}</option>)}</select><Input aria-label="上游权重" disabled={pending} type="number" min="0" max="100" value={upstream.weight} onChange={(event) => updateUpstream(index, { weight: Number(event.target.value) })} /><Button type="button" variant="ghost" size="icon" disabled={pending || form.upstreams.length === 1} aria-label="删除上游" onClick={() => setForm({ ...form, upstreams: form.upstreams.filter((_, upstreamIndex) => upstreamIndex !== index) })}><Trash2 className="size-4 text-destructive" /></Button></div><MappingEditor label="上游模型映射（仅对此上游生效，覆盖模型连接级别映射）" value={upstream.modelMappings} onChange={(modelMappings) => updateUpstream(index, { modelMappings })} /></div>; })}</div>
    <div className="space-y-3 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <Label>请求模型匹配</Label>
          <InfoTip label="模型匹配规则说明">
            <span className="block">精确（EXACT）：只匹配指定的模型别名。</span>
            <span className="mt-1 block">前缀（PRE）：匹配以该值开头的所有别名，不要加 *。</span>
            <span className="mt-1 block">不添加任何匹配规则会变成通配符路由，容易造成绑定表混乱。</span>
          </InfoTip>
        </div>
        <Button type="button" variant="outline" size="sm" disabled={pending} onClick={() => setForm({ ...form, modelPredicates: [...form.modelPredicates, { matchType: 'EXACT', matchValue: '' }] })}><Plus className="mr-1 size-3" />添加匹配</Button>
      </div>
      {form.modelPredicates.length === 0 && (
        <p className="text-xs text-muted-foreground italic">尚未添加匹配规则，当前为通配符路由（不推荐）</p>
      )}
      {form.modelPredicates.map((predicate, index) => <div className="grid gap-2 md:grid-cols-[150px_1fr_36px]" key={index}><select aria-label="模型匹配类型" disabled={pending} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={predicate.matchType} onChange={(event) => setForm({ ...form, modelPredicates: form.modelPredicates.map((item, itemIndex) => itemIndex === index ? { ...item, matchType: event.target.value } : item) })}><option value="EXACT">精确（EXACT）</option><option value="PRE">前缀（PRE）</option></select><Input aria-label="模型匹配值" disabled={pending} value={predicate.matchValue} placeholder={predicate.matchType === 'EXACT' ? '例: deepseek-chat' : '例: kimi-'} onChange={(event) => setForm({ ...form, modelPredicates: form.modelPredicates.map((item, itemIndex) => itemIndex === index ? { ...item, matchValue: event.target.value } : item) })} /><Button type="button" variant="ghost" size="icon" disabled={pending} aria-label="删除模型匹配" onClick={() => setForm({ ...form, modelPredicates: form.modelPredicates.filter((_, itemIndex) => itemIndex !== index) })}><Trash2 className="size-4 text-destructive" /></Button></div>)}</div>
    <div className="space-y-3 rounded-md border p-3"><div className="flex items-center gap-2"><Input id="route-auth" className="size-4" type="checkbox" checked={form.authConfig.enabled} disabled={pending} onChange={(event) => setForm({ ...form, authConfig: { ...form.authConfig, enabled: event.target.checked } })} /><Label htmlFor="route-auth">启用认证</Label><InfoTip label="路由认证与授权说明">新增路由不会自动授权已有 Worker。保存后请在 Consumers 中检查绑定范围，并在 Worker 编辑页验证已保存模型；模型连接连接成功不代表 Worker 已有访问权限。</InfoTip></div>{form.authConfig.enabled && <div className="flex items-center gap-2"><Input id="key-auth" className="size-4" type="checkbox" checked={form.authConfig.allowedCredentialTypes.includes('key-auth')} disabled={pending} onChange={(event) => setForm({ ...form, authConfig: { ...form.authConfig, allowedCredentialTypes: event.target.checked ? ['key-auth'] : [] } })} /><Label htmlFor="key-auth">Key Auth</Label></div>}
      {form.authConfig.enabled && <div className="space-y-2"><div className="flex items-center gap-1"><Label htmlFor="route-consumers">授权 Consumer（逗号分隔）</Label><InfoTip label="Consumer 授权说明">只授权此路由；Worker Consumer 通常为 worker-加运行时名称。保存后在 Worker 编辑页验证，不要通过关闭认证解决授权失败。</InfoTip></div><ConsumerNamesInput value={form.authConfig.allowedConsumers || []} disabled={pending} onChange={(allowedConsumers) => setForm({ ...form, authConfig: { ...form.authConfig, allowedConsumers } })} /></div>}
    </div>
    <div><Label>回退配置</Label>{fallbackConfigWritable ? <textarea disabled={pending} className="min-h-28 w-full rounded-md border border-input bg-transparent p-3 font-mono text-sm" value={fallbackJson} onChange={(event) => setFallbackJson(event.target.value)} placeholder={'{\n  "maxRetries": 2\n}'} /> : <p className="mt-2 rounded-md border border-border bg-muted/30 p-3 text-sm text-muted-foreground">{summarizeFallbackConfig(route?.fallbackConfig)}。当前 Higress Console API 版本仅提供只读摘要。</p>}</div>
    <FormErrors errors={errors} />
  </div><DialogFooter><Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>取消</Button><Button disabled={pending} onClick={submit}>{pending && <Loader2 className="mr-1 size-4 animate-spin" />}{editing ? '保存修改' : '创建路由'}</Button></DialogFooter></DialogContent></Dialog>;
}

function RouteProviderSwitchDialog({ open, route, providers, onOpenChange }: { open: boolean; route: AiRoute | null; providers: LlmProviderResponse[]; onOpenChange: (_open: boolean) => void }) {
  const update = useUpdateAiRoute();
  const currentProviders = route?.upstreams.map((upstream) => upstream.provider) ?? [];
  const candidates = providers.filter((provider) => provider.tokenCount > 0 && !currentProviders.includes(provider.name));
  const [selected, setSelected] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const pending = update.isPending;

  const submit = () => {
    if (!route || !selected) return;
    // Preserve the route structure: keep every upstream (and its model
    // mapping / failover config), only shift weights so the target provider
    // takes 100% of the traffic. Adds the target as a new upstream when it is
    // not part of the route yet.
    // Reuse serializeRouteForm so that modelPredicates matchType is correctly
    // normalised to the API format (EQUAL/PRE) and upstream modelMappings are
    // serialised the same way the form editor does.
    const existing = route.upstreams.some((upstream) => upstream.provider === selected);
    const upstreams = route.upstreams.map((upstream) => ({
      ...upstream,
      weight: upstream.provider === selected ? 100 : 0,
    }));
    if (!existing) {
      upstreams.push({ provider: selected, weight: 100, modelMapping: {} });
    }
    const tempForm: RouteForm = {
      name: route.name,
      pathPredicate: route.pathPredicate,
      upstreams: upstreams.map((u) => ({
        provider: u.provider,
        weight: u.weight,
        modelMappings: mappingRules(u.modelMapping),
      })),
      modelPredicates: route.modelPredicates ?? [],
      authConfig: route.authConfig ?? { enabled: true, allowedCredentialTypes: ['key-auth'] },
      ...(route.fallbackConfig ? { fallbackConfig: route.fallbackConfig } : {}),
    };
    const payload = serializeRouteForm(tempForm);
    update.mutate({
      name: route.name,
      data: { ...payload, domains: route.domains },
    }, {
      onSuccess: () => { onOpenChange(false); setSelected(''); },
      onError: (error) => setErrors([error.message]),
    });
  };

  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-w-[95vw] sm:max-w-md"><DialogHeader><DialogTitle>切换模型连接 - {route?.name}</DialogTitle></DialogHeader><div className="space-y-4 py-2">
    <div className="rounded-md border border-border/50 bg-muted/30 p-3 text-xs text-muted-foreground"><p>当前上游模型连接：{currentProviders.length > 0 ? currentProviders.join('、') : '-'}</p><InfoTip label="切换模型连接说明">切换将调整权重使目标模型连接接管 100% 流量，其余上游权重置 0；现有上游的模型映射与故障转移配置均保留。若目标模型连接尚未在路由中，将追加为新上游，其模型映射为空，需在编辑路由中补充别名映射后才能正常解析。</InfoTip></div>
    <div><Label>目标模型连接 *</Label><select aria-label="目标模型连接" disabled={pending} className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">选择模型连接...</option>{candidates.map((provider) => <option key={provider.name} value={provider.name}>{provider.name}（{PROVIDER_TYPES.find((type) => type.value === provider.type)?.label || provider.type}，{provider.tokenCount} 个 API Key）</option>)}</select>{candidates.length === 0 && <p className="mt-2 text-xs text-amber-600">没有可切换的模型连接（当前路由已使用全部可用模型连接）。请先添加新的模型连接。</p>}</div>
    <FormErrors errors={errors} />
  </div><DialogFooter><Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>取消</Button><Button disabled={pending || !selected} onClick={submit}>{pending && <Loader2 className="mr-1 size-4 animate-spin" />}切换并保存</Button></DialogFooter></DialogContent></Dialog>;
}

export function ModelsSection() {
  const consoleAccess = useHigressConsoleAccess();
  const { data: infrastructure } = useInfrastructure();
  const providersQuery = useModels(consoleAccess.canManage);
  const routesQuery = useAiRoutes(consoleAccess.canManage);
  const deleteProvider = useDeleteModel();
  const deleteRoute = useDeleteAiRoute();
  const [providerDialog, setProviderDialog] = useState<LlmProviderResponse | null | undefined>(undefined);
  const [routeDialog, setRouteDialog] = useState<AiRoute | null | undefined>(undefined);
  const [switchRoute, setSwitchRoute] = useState<AiRoute | null>(null);
  const [testProvider, setTestProvider] = useState<LlmProviderResponse | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ type: 'provider' | 'route'; name: string } | null>(null);
  const providers = providersQuery.data ?? [];
  const routes = routesQuery.data ?? [];
  const providerNames = providers.map((provider) => provider.name);
  const providerInUse = deleteTarget?.type === 'provider' ? routes.filter((route) => route.upstreams.some((upstream) => upstream.provider === deleteTarget.name)).map((route) => route.name) : [];
  const deleting = deleteProvider.isPending || deleteRoute.isPending;
  const confirmDelete = () => {
    if (!deleteTarget) return;
    const onSuccess = () => setDeleteTarget(null);
    const onError = () => undefined;
    if (deleteTarget.type === 'provider') deleteProvider.mutate(deleteTarget.name, { onSuccess, onError });
    else deleteRoute.mutate(deleteTarget.name, { onSuccess, onError });
  };
  if (!consoleAccess.canManage) return <ModelsSessionFallback reason={consoleAccess.reason} isLoading={consoleAccess.isLoading} />;
  return <div className="space-y-4">
    <SectionHeader title="模型管理" meta={<span className="text-sm text-muted-foreground">{providers.length} 个模型连接 · {routes.length} 条路由</span>} />
    <ManagerModelSetup />
    <RuntimeStatusCard higress={infrastructure?.higress} />
    <Tabs defaultValue="providers" className="gap-4">
      <TabsList aria-label="模型配置分类" className="max-w-full justify-start overflow-x-auto [&>[role=tab]]:shrink-0">
        <TabsTrigger value="providers">模型连接</TabsTrigger>
        <TabsTrigger value="routes">AI 路由</TabsTrigger>
        <TabsTrigger value="access">访问凭证</TabsTrigger>
        <TabsTrigger value="limits">限流与参考</TabsTrigger>
      </TabsList>
      <TabsContent value="providers">
    <Card className="gap-0 py-0 shadow-none"><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b px-4 py-3"><div className="space-y-1"><CardTitle className="flex flex-wrap items-center gap-3 text-base">模型连接<span className="text-sm font-normal text-muted-foreground">共 {providers.length} 个模型连接</span></CardTitle><CardDescription>连接模型服务：地址、协议和密钥</CardDescription></div><Button variant="outline" size="sm" disabled={deleting} onClick={() => setProviderDialog(null)}>添加连接</Button></CardHeader><CardContent className="space-y-4 p-4"><ResourceError error={providersQuery.error} /><ProviderTable loading={providersQuery.isLoading} providers={providers} pending={deleting} onEdit={setProviderDialog} onTest={setTestProvider} onDelete={(name) => setDeleteTarget({ type: 'provider', name })} /></CardContent></Card>
      </TabsContent>
      <TabsContent value="routes">
    <Card className="gap-0 py-0 shadow-none"><CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 border-b px-4 py-3"><div className="space-y-1"><CardTitle className="flex items-center gap-1 text-base">AI 路由<InfoTip label="AI 路由分发说明">AI 路由按 model 别名分发到不同模型连接。所有 AI 路由共享网关路径前缀（默认 /v1），网关通过请求体中的 model 别名匹配对应路由分发到不同模型连接；给不同模型连接配置不同的模型映射别名即可实现多路分发。</InfoTip><span className="ml-2 text-sm font-normal text-muted-foreground">{routes.length} 条</span></CardTitle><CardDescription>决定请求由哪个模型连接处理，以及哪些 Agent 可以访问</CardDescription></div><Button variant="outline" size="sm" disabled={deleting || providerNames.length === 0} onClick={() => setRouteDialog(null)}>添加路由</Button></CardHeader><CardContent className="space-y-4 p-4">{providerNames.length === 0 && <p className="text-sm text-muted-foreground">请先创建至少一个模型连接后再添加路由。</p>}<ResourceError error={routesQuery.error} /><RouteTable loading={routesQuery.isLoading} routes={routes} pending={deleting} onEdit={setRouteDialog} onSwitch={setSwitchRoute} onDelete={(name) => setDeleteTarget({ type: 'route', name })} /></CardContent></Card>
      </TabsContent>
      <TabsContent value="access"><ConsumerSection /></TabsContent>
      <TabsContent value="limits" className="space-y-4"><RateLimitSection routes={routes} /><HigressReferencePanel /></TabsContent>
    </Tabs>
    <ProviderDialog key={`provider-${providerDialog?.name ?? 'new'}-${providerDialog !== undefined}`} open={providerDialog !== undefined} provider={providerDialog ?? null} onOpenChange={(open) => !open && setProviderDialog(undefined)} /><RouteDialog key={`route-${routeDialog?.name ?? 'new'}-${routeDialog !== undefined}`} open={routeDialog !== undefined} route={routeDialog ?? null} providerNames={providerNames} fallbackConfigWritable={routes.some((item) => item.fallbackConfigWritable)} onOpenChange={(open) => !open && setRouteDialog(undefined)} /><RouteProviderSwitchDialog key={`switch-${switchRoute?.name ?? 'none'}`} open={switchRoute !== null} route={switchRoute} providers={providers} onOpenChange={(open) => !open && setSwitchRoute(null)} />
    {testProvider ? <ConnectionTestDialog key={testProvider.name} provider={testProvider} onClose={() => setTestProvider(null)} /> : null}
    <AlertDialog open={Boolean(deleteTarget)} onOpenChange={(open) => !open && !deleting && setDeleteTarget(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认删除{deleteTarget?.type === 'provider' ? '模型连接' : '路由'}</AlertDialogTitle><AlertDialogDescription>{deleteTarget?.type === 'provider' && providerInUse.length > 0 ? `以下路由仍引用该模型连接：${providerInUse.join('、')}。删除后这些路由将失效。` : `将删除 ${deleteTarget?.name ?? ''}，此操作无法撤销。`}</AlertDialogDescription>{(deleteProvider.isError || deleteRoute.isError) && <p className="text-sm text-destructive">{(deleteProvider.error ?? deleteRoute.error)?.message}</p>}</AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel><AlertDialogAction disabled={deleting} onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deleting && <Loader2 className="mr-1 inline size-4 animate-spin" />}删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

// Console 会话不可用时的降级视图：保留原因说明 + 追加只读模型网关路由目录
// （Controller #1242，token 鉴权，L1 可读）——治「Console 会话反复失效 → 模型
// 面整块不可用」的实痛：即使 Console 会话挂了，L1 仍能看到已配置的路由/
// 模型连接/授权 consumer（编辑仍需有效 Console 会话）。旧 Controller 404 → 隐藏；
// L2 403 → 权限提示。
function ModelsSessionFallback({ reason, isLoading }: { reason?: string; isLoading: boolean }) {
  const catalog = useGatewayRouteCatalog();
  return <div className="space-y-4">
    <SectionHeader title="Higress Console 管理" description="模型连接和 AI 路由由外部 Higress Console 管理" />
    <div className="rounded-lg border border-border/50 bg-muted/30 p-4 text-sm text-muted-foreground">{isLoading ? '正在检查 Higress Console 状态...' : (reason || '需要有效的 Higress Console 会话')}</div>
    {catalog.off ? null : catalog.noAccess ? (
      <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-600">仅 L1 管理员可查看只读路由目录（当前会话无权限）。恢复 Console 会话后即可管理。</div>
    ) : (
      <Card className="glass-card"><CardHeader><CardTitle className="text-base">模型网关路由（只读降级视图）</CardTitle><CardDescription>来自 Controller 只读路由目录（Console 会话不可用时的降级展示；路由名=网关 /v1 入口，非模型 ID。编辑仍需有效 Console 会话）</CardDescription></CardHeader><CardContent>{catalog.loading ? <p className="text-sm text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />加载中...</p> : catalog.routes.length === 0 ? <p className="text-sm text-muted-foreground">暂无 AI 路由（网关未配置路由）</p> : <Table className="min-w-[800px] table-fixed"><TableHeader><TableRow><TableHead>路由名</TableHead><TableHead>上游模型连接</TableHead><TableHead>授权 Consumer</TableHead></TableRow></TableHeader><TableBody>{catalog.routes.map((route) => <TableRow key={route.name}><TableCell className="font-mono text-xs"><OverflowText text={route.name} /></TableCell><TableCell><OverflowText text={(route.upstreams ?? []).map((upstream) => `${upstream.provider}${typeof upstream.weight === 'number' ? ` (${upstream.weight}%)` : ''}`).join('、')} className="text-xs" /></TableCell><TableCell><OverflowText text={(route.allowedConsumers ?? []).join('、')} className="text-xs" /></TableCell></TableRow>)}</TableBody></Table>}</CardContent></Card>
    )}
  </div>;
}

function ResourceError({ error }: { error: Error | null }) { return error ? <p className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm text-destructive">加载失败：{error.message}</p> : null; }

function ProviderTable({ loading, providers, pending, onEdit, onTest, onDelete }: { loading: boolean; providers: LlmProviderResponse[]; pending: boolean; onEdit: (_provider: LlmProviderResponse) => void; onTest: (_provider: LlmProviderResponse) => void; onDelete: (_name: string) => void }) { return <Table className="min-w-[800px] table-fixed"><TableHeader><TableRow><TableHead>名称</TableHead><TableHead>类型</TableHead><TableHead>协议</TableHead><TableHead>API Key 数量</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{loading ? <LoadingRow /> : providers.length === 0 ? <EmptyRow icon={<Server className="mx-auto mb-2 size-8 text-muted-foreground/50" />} text="暂无 AI 模型连接配置" /> : providers.map((provider) => <TableRow key={provider.name}><TableCell className="font-medium"><div className="flex items-center gap-2"><Server className="size-3.5 shrink-0 text-muted-foreground" /><OverflowText text={provider.name} /></div></TableCell><TableCell><Badge variant="outline" className="text-xs">{PROVIDER_TYPES.find((type) => type.value === modelProviderType(provider))?.label || provider.type}</Badge></TableCell><TableCell className="font-mono text-xs text-muted-foreground">{provider.protocol || 'openai/v1'}</TableCell><TableCell><span className="flex items-center gap-1 text-xs"><Key className="size-3 text-muted-foreground" />{provider.tokenCount} 个</span></TableCell><TableCell className="text-right"><Button variant="outline" size="sm" className="mr-1" title="测试连接" aria-label={`测试连接 ${provider.name}`} disabled={pending || provider.tokenCount === 0} onClick={() => onTest(provider)}><Play className="mr-1 size-3.5" />测试</Button><Button variant="ghost" size="icon" title="编辑模型连接" aria-label={`编辑 ${provider.name}`} disabled={pending} onClick={() => onEdit(provider)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" title="删除模型连接" aria-label={`删除 ${provider.name}`} disabled={pending} onClick={() => onDelete(provider.name)}><Trash2 className="size-4 text-destructive" /></Button></TableCell></TableRow>)}</TableBody></Table>; }

function RouteTable({ loading, routes, pending, onEdit, onSwitch, onDelete }: { loading: boolean; routes: AiRoute[]; pending: boolean; onEdit: (_route: AiRoute) => void; onSwitch: (_route: AiRoute) => void; onDelete: (_name: string) => void }) { return <Table className="min-w-[800px] table-fixed"><TableHeader><TableRow><TableHead>名称</TableHead><TableHead>路径</TableHead><TableHead>上游模型连接</TableHead><TableHead>认证 / 授权 Consumer</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{loading ? <LoadingRow /> : routes.length === 0 ? <EmptyRow icon={<Route className="mx-auto mb-2 size-8 text-muted-foreground/50" />} text="暂无 AI 路由" /> : routes.map((route) => <TableRow key={route.name}><TableCell className="font-medium"><div className="flex items-center gap-2"><Route className="size-3.5 shrink-0 text-muted-foreground" /><OverflowText text={route.name} /></div></TableCell><TableCell className="font-mono text-xs text-muted-foreground"><OverflowText text={route.pathPredicate.matchValue} /></TableCell><TableCell><OverflowText text={route.upstreams.map((upstream) => `${upstream.provider} (${upstream.weight}%)`).join('、')} className="text-xs" /></TableCell><TableCell>{route.authConfig?.enabled ? <div className="flex min-w-0 items-center gap-1"><Badge variant="outline" className="text-xs">已启用</Badge><OverflowText text={(route.authConfig?.allowedConsumers ?? []).join('、')} className="text-xs" />{(route.authConfig?.allowedConsumers ?? []).length === 0 && <span className="text-xs text-muted-foreground">未限定 Consumer</span>}</div> : <span className="text-xs text-muted-foreground">未启用</span>}</TableCell><TableCell className="text-right"><Button variant="ghost" size="icon" title="切换模型连接" aria-label={`切换 ${route.name} 模型连接`} disabled={pending} onClick={() => onSwitch(route)}><ArrowLeftRight className="size-4 text-muted-foreground" /></Button><Button variant="ghost" size="icon" title="编辑路由" aria-label={`编辑 ${route.name}`} disabled={pending} onClick={() => onEdit(route)}><Pencil className="size-4" /></Button><Button variant="ghost" size="icon" title="删除路由" aria-label={`删除 ${route.name}`} disabled={pending} onClick={() => onDelete(route.name)}><Trash2 className="size-4 text-destructive" /></Button></TableCell></TableRow>)}</TableBody></Table>; }

function LoadingRow() { return <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />加载中...</TableCell></TableRow>; }
function EmptyRow({ icon, text }: { icon: ReactNode; text: string }) { return <TableRow><TableCell colSpan={5} className="py-8 text-center text-muted-foreground">{icon}{text}</TableCell></TableRow>; }

// ============ Higress Reference Panel ============

function HigressReferencePanel() {
  const [open, setOpen] = useState(false);
  return <div className="rounded-lg border border-border/50 bg-muted/30 overflow-hidden">
    <button className="w-full flex items-center gap-2 px-4 py-2 text-xs text-muted-foreground hover:bg-muted/50 transition-colors" onClick={() => setOpen((v) => !v)} aria-expanded={open}>
      <Info className="size-3.5 shrink-0" />
      <span>Higress 网关对接参考</span>
      {open ? <ChevronDown className="size-3.5 ml-auto" /> : <ChevronRight className="size-3.5 ml-auto" />}
    </button>
    {open && <div className="px-4 pb-3 text-xs text-muted-foreground space-y-2">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="font-medium text-foreground">数据面端点</p>
          <p>• <code className="font-mono">POST /v1/chat/completions</code> — 对话补全（支持流式）</p>
          <p>• <code className="font-mono">POST /v1/embeddings</code> — 向量化（memorySearch 使用）</p>
          <p>• <code className="font-mono">GET /v1/models</code> — 仅认证/连通性探测（非完整模型列表）</p>
          <p>• <code className="font-mono">POST /mcp-servers/{'{name}'}/mcp</code> — MCP Server 端点（Streamable HTTP）</p>
        </div>
        <div className="space-y-1">
          <p className="font-medium text-foreground">认证方式</p>
          <p>• LLM/MCP：key-auth Bearer，凭据为 Consumer <code className="font-mono">GatewayKey</code></p>
          <p>• 授权范围：<code className="font-mono">authConfig.allowedConsumers</code></p>
          <p>• 暴露 Worker 端口：无认证（公开）</p>
          <p>• OpenClaw Console：basic-auth（<code className="font-mono">AGENTTEAMS_ADMIN_USER</code>）</p>
        </div>
      </div>
      <p>• Gateway 健康探测使用 <code className="font-mono">POST /v1/chat/completions</code>；仅 404 判为不可用，401/403 仍视为数据面已服务。</p>
      <p>• 嵌入模式默认域名：<code className="font-mono">aigw-local.agentteams.io:8080</code>（容器内）/ <code className="font-mono">:18080</code>（宿主机）。Console：<code className="font-mono">agentteams-controller:8001</code>（容器内）/ <code className="font-mono">:18001</code>（宿主机）。</p>
    </div>}
  </div>;
}

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
  const bindConsumer = useBindConsumer();
  const [showAdd, setShowAdd] = useState(false);
  const [consumerName, setConsumerName] = useState('');
  const [consumerKey, setConsumerKey] = useState('');
  const [consumerPendingDeletion, setConsumerPendingDeletion] = useState<string | null>(null);
  const [createdKey, setCreatedKey] = useState<{ name: string; key: string } | null>(null);

  const copyCreatedKey = useCallback(async () => {
    if (!createdKey) return;
    try {
      await navigator.clipboard.writeText(createdKey.key);
      toast.success('API Key 已复制');
    } catch {
      toast.error('复制失败，请手动选中复制');
    }
  }, [createdKey]);

  const handleCreate = useCallback(async () => {
    if (!consumerName.trim()) return;
    try {
      const created = await createConsumer.mutateAsync({
        name: consumerName.trim(),
        credential_key: consumerKey.trim() || undefined,
      });
      if (created?.api_key) {
        // The full key lives in memory only and is shown until dismissed;
        // it is never written to localStorage or the notification store.
        setCreatedKey({ name: consumerName.trim(), key: created.api_key });
        toast.success(`Consumer "${consumerName}" 已创建，请及时复制 API Key`);
      } else {
        toast.success(`Consumer "${consumerName}" 已创建`);
      }
      setConsumerName('');
      setConsumerKey('');
      setShowAdd(false);
      try {
        await bindConsumer.mutateAsync(consumerName.trim());
        toast.success(`Consumer "${consumerName}" 已自动绑定到 AI 路由`);
      } catch (bindErr) {
        toast.error(bindErr instanceof Error ? `自动绑定失败：${bindErr.message}` : '自动绑定失败');
      }
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    }
  }, [consumerName, consumerKey, createConsumer, bindConsumer]);

  const handleBind = useCallback(async (name: string) => {
    try {
      await bindConsumer.mutateAsync(name);
      toast.success(`Consumer "${name}" 已绑定到 AI 路由`);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '绑定失败');
    }
  }, [bindConsumer]);

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
    {createdKey && <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3"><AlertTriangle className="mt-0.5 size-4 shrink-0 text-amber-500" /><div className="flex-1 text-xs"><p className="font-medium">Consumer "{createdKey.name}" 已创建</p><p className="mt-1 break-all font-mono text-sm">{createdKey.key}</p><p className="mt-1 text-muted-foreground">API Key 仅在本次显示，关闭后将无法再次查看，请立即复制保存。</p></div><div className="flex shrink-0 gap-2"><Button variant="outline" size="sm" aria-label="复制 API Key" onClick={copyCreatedKey}>复制</Button><Button variant="ghost" size="sm" onClick={() => setCreatedKey(null)}>关闭</Button></div></div>}
    {showAdd && <div className="flex items-end gap-2 p-3 border border-border rounded-lg bg-card/50"><div className="flex-1"><Label className="text-xs">名称</Label><Input value={consumerName} onChange={(e) => setConsumerName(e.target.value)} placeholder="consumer-name" className="h-8 text-sm" /></div><div className="flex-1"><Label className="text-xs">API Key (可选)</Label><Input value={consumerKey} onChange={(e) => setConsumerKey(e.target.value)} placeholder="留空自动生成" type="password" className="h-8 text-sm" /></div><Button size="sm" onClick={handleCreate} disabled={!consumerName.trim() || createConsumer.isPending}>{createConsumer.isPending ? <Loader2 className="mr-1 size-3.5 animate-spin" /> : '创建'}</Button><Button variant="ghost" size="sm" onClick={() => setShowAdd(false)}>取消</Button></div>}
    {consumerListUnsupported && <div className="flex items-start gap-2 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-muted-foreground"><AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" /><p>当前 Controller 版本缺少 GET /api/v1/gateway/consumers 接口，无法获取 Consumer 列表，仍可创建新 Consumer。</p></div>}
    {consumersError && <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive"><AlertTriangle className="size-4 shrink-0 mt-0.5" /><p>Consumer 列表加载失败: {formatErrorMessage(consumersError)}</p></div>}
    <Table className="min-w-[800px] table-fixed"><TableHeader><TableRow><TableHead>名称</TableHead><TableHead>凭证</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>{consumersLoading ? <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground"><Loader2 className="mr-2 inline size-4 animate-spin" />加载中...</TableCell></TableRow> : !consumersLoading && consumers?.length === 0 ? <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground">暂无 Consumer</TableCell></TableRow> : consumers?.map((consumer) => <TableRow key={consumer.name}><TableCell className="font-medium"><div className="flex items-center gap-2"><Key className="size-3.5 shrink-0 text-muted-foreground" /><OverflowText text={consumer.name} /></div></TableCell><TableCell>{consumer.status && <Badge variant="outline" className="text-xs">{consumer.status}</Badge>}</TableCell><TableCell className="text-right"><Button variant="ghost" size="sm" title="绑定到 AI 路由" aria-label={`绑定 ${consumer.name}`} onClick={() => handleBind(consumer.name)} disabled={bindConsumer.isPending || deleteConsumer.isPending}><Link2 className="size-4 text-muted-foreground" /></Button><Button variant="ghost" size="sm" aria-label={`删除 ${consumer.name}`} onClick={() => setConsumerPendingDeletion(consumer.name)} disabled={bindConsumer.isPending || deleteConsumer.isPending}><Trash2 className="size-4 text-destructive" /></Button></TableCell></TableRow>)}</TableBody></Table>
    <AlertDialog open={Boolean(consumerPendingDeletion)} onOpenChange={(open) => !open && !deleteConsumer.isPending && setConsumerPendingDeletion(null)}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>确认删除 Consumer</AlertDialogTitle><AlertDialogDescription>将删除 {consumerPendingDeletion ?? ''} 的认证凭证。依赖该凭证的调用将无法通过 Higress 认证。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={deleteConsumer.isPending}>取消</AlertDialogCancel><AlertDialogAction disabled={deleteConsumer.isPending} onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">{deleteConsumer.isPending && <Loader2 className="mr-1 inline size-4 animate-spin" />}删除</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}

// ============ Runtime Model Access Status ============

function RuntimeStatusCard({ higress }: { higress: HigressStatus | undefined }) {
  const gateway = higress?.gateway;
  const console_ = higress?.console;
  const [expanded, setExpanded] = useState(false);
  if (!higress) return null;

  const modeLabel = higress.mode === 'external' ? '外部适配' : '嵌入直连';
  const gatewayLabel = gateway?.configured
    ? gateway.endpoint
    : '未配置';
  const consoleLabel = console_?.configured
    ? console_.endpoint
    : '未配置';

  const summary = higress.mode === 'external'
    ? gateway?.state === 'reachable'
      ? `Manager/Worker 经 Higress Gateway 访问模型：${gatewayLabel}`
      : '外部适配模式尚未配置可用的 Gateway 数据平面地址'
    : gateway?.state === 'reachable'
      ? `嵌入模式经 Gateway 访问：${gatewayLabel}`
      : 'Controller 直连 LLM Provider（未启用 Gateway 数据平面）';

  return <div className="space-y-3">
    <div className="flex items-center gap-3 rounded-lg border border-border/50 bg-muted/30 p-4">
      <Zap className={`size-4 shrink-0 ${higress.healthy ? 'text-emerald-500' : 'text-amber-500'}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">运行时模型访问方式</p>
        <p className="mt-0.5 truncate text-xs text-muted-foreground" title={summary}>{summary}</p>
      </div>
      <Badge variant="secondary" className="shrink-0 text-xs">{modeLabel}</Badge>
      <button className="shrink-0 text-muted-foreground hover:text-foreground" onClick={() => setExpanded((v) => !v)} aria-label={expanded ? '收起详情' : '展开详情'}>
        {expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
      </button>
    </div>
    {expanded && <div className="grid gap-3 rounded-lg border border-border/50 bg-card/50 p-4 text-xs">
      <div className="grid gap-2 sm:grid-cols-2">
        <div className="space-y-1">
          <p className="font-medium flex items-center gap-1.5"><Globe className="size-3.5 text-cyan-500" />Gateway 数据平面</p>
          <p className="font-mono text-xs text-muted-foreground break-all">{gatewayLabel}</p>
          <div className="flex items-center gap-1.5">
            {gateway?.state === 'reachable' && <Monitor className="size-3 text-emerald-500" />}
            {gateway?.state === 'unreachable' && <AlertTriangle className="size-3 text-amber-500" />}
            {gateway?.state === 'unconfigured' && <Globe className="size-3 text-muted-foreground" />}
            <span className="text-xs text-muted-foreground capitalize">{gateway?.state}</span>
            {gateway?.httpStatus !== undefined && <span className="text-xs text-muted-foreground/70">HTTP {gateway.httpStatus}</span>}
          </div>
          {gateway?.error && <p className="text-xs text-destructive">{gateway.error}</p>}
        </div>
        <div className="space-y-1">
          <p className="font-medium flex items-center gap-1.5"><Server className="size-3.5 text-violet-500" />Console 管理端</p>
          <p className="font-mono text-xs text-muted-foreground break-all">{consoleLabel}</p>
          <div className="flex items-center gap-1.5">
            {console_?.state === 'reachable' && <Monitor className="size-3 text-emerald-500" />}
            {console_?.state === 'unreachable' && <AlertTriangle className="size-3 text-amber-500" />}
            {console_?.state === 'unconfigured' && <Server className="size-3 text-muted-foreground" />}
            <span className="text-xs text-muted-foreground capitalize">{console_?.state}</span>
            {console_?.httpStatus !== undefined && <span className="text-xs text-muted-foreground/70">HTTP {console_.httpStatus}</span>}
          </div>
          {console_?.error && <p className="text-xs text-destructive">{console_.error}</p>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">健康状态以 Gateway POST /v1/chat/completions 探测为准；仅 404 表示 AI 路由未代理。Console 为可选管理端，不影响运行时可用状态。</p>
    </div>}
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
    {configs.map((config, idx) => <div key={`${config.routeName}-${idx}`} className={`flex items-center gap-3 p-3 rounded-lg border ${config.enabled ? 'border-border bg-card/50' : 'border-border/50 bg-muted/20 opacity-60'}`}><button type="button" onClick={() => handleToggle(idx)} role="switch" aria-checked={config.enabled} aria-label={`限流规则 ${config.routeName} 启用状态`}>{config.enabled ? <ToggleRight className="size-5 text-emerald-500" aria-hidden="true" /> : <ToggleLeft className="size-5 text-gray-400" aria-hidden="true" />}</button><div className="flex-1 min-w-0"><div className="flex items-center gap-2"><Route className="size-3.5 text-muted-foreground" /><span className="text-xs font-medium">{config.routeName}</span>{config.perConsumer && <Badge variant="secondary" className="text-xs">按 Consumer</Badge>}</div><div className="flex items-center gap-3 mt-1 text-xs text-muted-foreground">{config.rps > 0 && <span className="flex items-center gap-1"><Zap className="size-3" />{config.rps} req/s</span>}{config.rpm > 0 && <span className="flex items-center gap-1"><Clock className="size-3" />{config.rpm} req/min</span>}{config.burst > 0 && <span>突发: {config.burst}</span>}</div></div><input type="number" className="w-16 h-7 rounded border border-input bg-transparent px-1.5 text-xs text-center" value={config.rps} onChange={(e) => handleUpdateField(idx, 'rps', parseInt(e.target.value) || 0)} title="RPS" /><span className="text-xs text-muted-foreground">req/s</span><Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={() => handleRemove(idx)}><Trash2 className="size-3.5 text-destructive" /></Button></div>)}
    {configs.length > 0 && <div className="border border-border/50 rounded-lg p-3 bg-muted/20"><div className="flex items-start gap-2"><AlertTriangle className="size-4 text-amber-500 shrink-0 mt-0.5" /><div className="text-xs text-muted-foreground space-y-0.5"><p>限流配置导出后需通过 Higress Console API 或 kubectl 应用到网关。</p><p>配置格式: Higress <code>wasm-rate-limit</code> 插件，支持 per-route 和 per-consumer 限流。</p></div></div></div>}
  </div>;
}

function ConsumerNamesInput({ value, disabled, onChange }: { value: string[]; disabled: boolean; onChange: (_names: string[]) => void }) {
  const [text, setText] = useState(value.join(', '));
  return <Input id="route-consumers" value={text} disabled={disabled} placeholder="worker-alice, manager" onChange={(event) => {
    setText(event.target.value);
    onChange([...new Set(event.target.value.split(',').map((name) => name.trim()).filter(Boolean))]);
  }} />;
}
