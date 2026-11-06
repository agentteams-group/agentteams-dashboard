'use client';

import { useCallback, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { apiUrl, extractErrorDetail } from '@/lib/api-base';

interface PublicSpeechConfig {
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
}

export function SpeechSettings({ canManage }: { canManage: boolean }) {
  const [config, setConfig] = useState<PublicSpeechConfig | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const applyConfig = (value: PublicSpeechConfig) => {
    setConfig(value);
    setBaseUrl(value.baseUrl);
    setModel(value.model);
    setApiKey('');
  };

  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(apiUrl('/api/agentteams/speech/config'), { cache: 'no-store', signal });
      if (!response.ok) throw new Error(await extractErrorDetail(response, '无法读取语音配置'));
      const value = await response.json();
      if (!signal?.aborted) applyConfig(value);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '无法读取语音配置');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!canManage) return;
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [canManage, load]);

  const save = async (clearApiKey = false) => {
    if (!config) return;
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const body = clearApiKey
        ? { baseUrl: config.baseUrl, model: config.model, clearApiKey: true }
        : { baseUrl, model, ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}) };
      const response = await fetch(apiUrl('/api/agentteams/speech/config'), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await extractErrorDetail(response, '语音配置保存失败'));
      applyConfig(await response.json());
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '语音配置保存失败');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="语音识别配置">
      <h3 className="text-sm font-medium">语音识别</h3>
      <p className="text-xs text-muted-foreground">默认使用本地免费识别。配置百炼后，可在对话框的麦克风菜单中选择付费识别。</p>
      {!canManage ? <p className="text-xs text-muted-foreground">请联系管理员配置百炼语音服务。</p> : loading ? (
        <p className="text-xs text-muted-foreground">加载语音配置…</p>
      ) : config ? (
        <form className="space-y-3" onSubmit={event => { event.preventDefault(); void save(); }}>
          <p className="text-xs text-muted-foreground">{config.apiKeyConfigured ? 'API Key 已配置' : 'API Key 尚未配置'}</p>
          <div className="space-y-1">
            <Label htmlFor="speech-api-key">百炼 API Key</Label>
            <Input id="speech-api-key" type="password" autoComplete="off" value={apiKey} disabled={saving}
              placeholder={config.apiKeyConfigured ? '留空保留已配置的 Key' : '填写百炼 API Key'}
              onChange={event => { setApiKey(event.target.value); setSaved(false); }} />
          </div>
          <div className="space-y-1">
            <Label htmlFor="speech-base-url">语音服务地址</Label>
            <Input id="speech-base-url" value={baseUrl} disabled={saving}
              onChange={event => { setBaseUrl(event.target.value); setSaved(false); }} />
            <p className="text-xs text-muted-foreground">使用百炼 OpenAI 兼容地址，API Key 需与地域匹配；更换服务主机时需重新填写 Key。</p>
          </div>
          <div className="space-y-1">
            <Label htmlFor="speech-model">语音识别模型</Label>
            <Input id="speech-model" value={model} disabled={saving}
              onChange={event => { setModel(event.target.value); setSaved(false); }} />
          </div>
          <p className="text-xs text-muted-foreground">Key 保存在服务端，页面不会回显。保存后立即生效；仅在选择百炼并提交录音时调用付费接口。</p>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="submit" size="sm" disabled={saving || !baseUrl.trim() || !model.trim()}>{saving ? '保存中…' : '保存语音配置'}</Button>
            <Button type="button" variant="outline" size="sm" disabled={saving || !config.apiKeyConfigured} onClick={() => void save(true)}>移除 API Key</Button>
            {saved && <span role="status" className="text-xs text-emerald-600">已保存，立即生效</span>}
          </div>
        </form>
      ) : <Button type="button" variant="outline" size="sm" onClick={() => void load()}>重新加载语音配置</Button>}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    </section>
  );
}
