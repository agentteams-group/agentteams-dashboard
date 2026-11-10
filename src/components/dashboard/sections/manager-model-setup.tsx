'use client';

import { useState, useSyncExternalStore } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useModelSelection } from '@/hooks/use-model-selection';
import { configureManagerModel } from '@/lib/configure-manager-model';
import { hashForSection, resolveHash } from '@/lib/nav-hash';

const PRESETS = {
  tokenplan: { label: '通义 Token 套餐', url: 'https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1', model: 'qwen3.6-plus' },
  bailian: { label: '阿里云百炼', url: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen3.6-plus' },
  custom: { label: '其他 OpenAI 兼容服务', url: '', model: '' },
};

function subscribeHash(callback: () => void) {
  window.addEventListener('hashchange', callback);
  return () => window.removeEventListener('hashchange', callback);
}

export function ManagerModelSetup() {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => '');
  const params = resolveHash(hash.replace(/^#/, ''), (section) => section === 'models')?.params;
  const manager = params?.get('manager');
  return manager ? <SetupForm key={manager} manager={manager} returnTo={params?.get('returnTo') || hashForSection('chat')} /> : null;
}

function SetupForm({ manager, returnTo }: { manager: string; returnTo: string }) {
  const queryClient = useQueryClient();
  const selection = useModelSelection();
  const [preset, setPreset] = useState('tokenplan');
  const [baseUrl, setBaseUrl] = useState(PRESETS.tokenplan.url);
  const [model, setModel] = useState(PRESETS.tokenplan.model);
  const [apiKey, setApiKey] = useState('');
  const [pending, setPending] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const existing = preset === 'existing';
  const finish = () => { window.location.hash = returnTo; };
  const submit = async () => {
    setPending(true);
    setError('');
    try {
      await configureManagerModel(manager, { model, ...(existing ? {} : { baseUrl, apiKey }) }, setProgress);
      setApiKey('');
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['manager-model-status', manager] }),
        queryClient.invalidateQueries({ queryKey: ['agentteams-managers'] }),
        queryClient.invalidateQueries({ queryKey: ['agentteams-models'] }),
        queryClient.invalidateQueries({ queryKey: ['agentteams-ai-routes'] }),
      ]);
      finish();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '配置失败，请重试。');
    } finally {
      setPending(false);
    }
  };
  return <Card>
    <CardHeader><CardTitle className="text-base">为 Manager 配置模型</CardTitle></CardHeader>
    <CardContent className="space-y-4">
      <p className="text-sm text-muted-foreground">保存并验证后返回对话，已输入的草稿会保留。</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-2"><Label htmlFor="setup-provider">模型服务</Label>
          <select id="setup-provider" className="h-10 w-full rounded-md border bg-background px-3 text-sm" disabled={pending} value={preset} onChange={(event) => {
            const next = event.target.value;
            setPreset(next);
            if (next === 'existing') setModel(selection.options.find((option) => option.binding?.available)?.alias ?? '');
            else { const selected = PRESETS[next as keyof typeof PRESETS]; setBaseUrl(selected.url); setModel(selected.model); }
          }}>
            {Object.entries(PRESETS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}
            {selection.options.some((option) => option.binding?.available) && <option value="existing">使用已配置的模型</option>}
          </select>
        </div>
        <div className="space-y-2"><Label htmlFor="setup-model">模型名称</Label>
          {existing ? <select id="setup-model" className="h-10 w-full rounded-md border bg-background px-3 text-sm" disabled={pending} value={model} onChange={(event) => setModel(event.target.value)}>
            {selection.options.filter((option) => option.binding?.available).map((option) => <option key={option.alias} value={option.alias}>{option.alias}</option>)}
          </select> : <Input id="setup-model" value={model} disabled={pending} onChange={(event) => setModel(event.target.value)} />}
        </div>
        {!existing && <>
          <div className="space-y-2"><Label htmlFor="setup-api-key">API Key</Label><Input id="setup-api-key" type="password" autoComplete="off" value={apiKey} disabled={pending} onChange={(event) => setApiKey(event.target.value)} /></div>
          {preset === 'custom' && <div className="space-y-2"><Label htmlFor="setup-base-url">服务地址（Base URL）</Label><Input id="setup-base-url" placeholder="https://example.com/v1" value={baseUrl} disabled={pending} onChange={(event) => setBaseUrl(event.target.value)} /></div>}
        </>}
      </div>
      {pending && <p role="status" className="text-sm text-muted-foreground">{progress}</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      <div className="flex gap-2"><Button disabled={pending || !model.trim() || (!existing && (!baseUrl.trim() || !apiKey.trim()))} onClick={submit}>{pending ? '配置中…' : '保存并开始对话'}</Button><Button variant="outline" disabled={pending} onClick={finish}>返回对话</Button></div>
    </CardContent>
  </Card>;
}
