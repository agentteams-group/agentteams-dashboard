"use client";

import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api-base';
import { MODEL_PROBE_POLICY_PATH, parseModelProbePolicy, type ModelProbePolicy } from '@/lib/model-probe-policy';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

interface PolicyForm { policy: ModelProbePolicy; hosts: string; allowPrivateNetwork: boolean; dirty: boolean; needsReload: boolean }
const policyForm = (policy: ModelProbePolicy): PolicyForm => ({ policy, hosts: policy.allowedHosts.join('\n'), allowPrivateNetwork: policy.allowPrivateNetwork, dirty: false, needsReload: false });

export function ModelProbePolicySettings({ active = true }: { active?: boolean }) {
  const [form, setForm] = useState<PolicyForm | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const load = useCallback(async (signal?: AbortSignal, preserveDraft = false) => {
    setLoading(true); setError(null); setSaved(false);
    try {
      const next = await parseModelProbePolicy(await fetch(apiUrl(MODEL_PROBE_POLICY_PATH), { cache: 'no-store', signal }));
      if (!signal?.aborted) setForm(current => preserveDraft && current?.dirty ? { ...current, needsReload: current.policy.revision !== next.revision } : policyForm(next));
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '无法读取内网白名单。');
    } finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    if (!active) return;
    const controller = new AbortController();
    void load(controller.signal, true);
    return () => controller.abort();
  }, [active, load]);
  const save = async () => {
    if (!form || form.needsReload) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const response = await fetch(apiUrl(MODEL_PROBE_POLICY_PATH), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedHosts: form.hosts.split(/[\n,]/).map(host => host.trim()).filter(Boolean), allowPrivateNetwork: form.allowPrivateNetwork, revision: form.policy.revision }),
      });
      if (response.status === 409) setForm(current => current ? { ...current, needsReload: true } : current);
      setForm(policyForm(await parseModelProbePolicy(response)));
      setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存内网白名单。'); }
    finally { setSaving(false); }
  };
  const policy = form?.policy;
  const hosts = form?.hosts ?? '';
  const allowPrivateNetwork = form?.allowPrivateNetwork ?? false;
  const needsReload = form?.needsReload ?? false;
  return <Card role="region" aria-label="内网白名单配置" className="max-w-3xl gap-0 py-0 shadow-none">
    <CardHeader className="border-b px-4 py-3"><CardTitle className="text-base">内网白名单</CardTitle><CardDescription>配置模型连接测试允许访问的内网主机，保存后立即生效，重启后保留。</CardDescription></CardHeader>
    <CardContent className="space-y-4 p-4">
      {loading ? <p className="text-sm text-muted-foreground">正在读取配置…</p> : null}
      {policy ? <p className="text-xs text-muted-foreground">{policy.source === 'persistent' ? '当前使用已保存的配置。' : '当前使用环境变量默认值；保存后以此配置为准。'} 公网模型服务默认可测，内网主机按下方配置放行。</p> : null}
      <div className="space-y-2">
        <Label htmlFor="probe-allowed-hosts">允许访问的内网主机</Label>
        <Textarea id="probe-allowed-hosts" rows={5} className="max-h-56 field-sizing-fixed font-mono" value={hosts} disabled={!policy || loading || saving} placeholder={'172.16.50.89\ngpu.example.local'} onChange={event => { setForm(current => current ? { ...current, hosts: event.target.value, dirty: true } : current); setSaved(false); }} />
        <p className="text-xs text-muted-foreground">每行一个主机名或 IP，也可用逗号分隔。不填写 http://、端口、路径或通配符。关闭「允许所有内网地址」且列表为空时，仅保留默认可测的公网地址。</p>
      </div>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm">高级选项</summary>
        <div className="mt-3 flex items-center justify-between gap-3">
          <Label htmlFor="probe-private-network">允许所有内网地址</Label>
          <Switch id="probe-private-network" checked={allowPrivateNetwork} disabled={!policy || loading || saving} onCheckedChange={checked => { setForm(current => current ? { ...current, allowPrivateNetwork: checked, dirty: true } : current); setSaved(false); }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">开启后，内网地址不再逐个匹配上面的主机列表。</p>
      </details>
      {needsReload && !error ? <p role="alert" className="text-sm text-destructive">白名单已更新，请重新加载后再保存，当前草稿已保留。</p> : null}
      {error ? <p role="alert" className="text-sm text-destructive break-words">{error}</p> : null}
      {saved ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">配置已保存，后续测试立即生效。</p> : null}
    </CardContent>
    <CardFooter className="justify-end gap-2 border-t px-4 py-3">
      <Button variant="outline" disabled={loading || saving} onClick={() => void load()}>重新加载</Button>
      <Button disabled={!policy || loading || saving || needsReload} onClick={() => void save()}>{saving ? '保存中…' : '保存配置'}</Button>
    </CardFooter>
  </Card>;
}
