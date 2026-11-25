'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiUrl } from '@/lib/api-base';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';

interface ProbePolicy {
  allowedHosts: string[];
  allowPrivateNetwork: boolean;
  revision: string;
  source: 'environment' | 'persistent';
}
const path = '/api/agentteams/models/probe-policy';

async function readPolicy(response: Response): Promise<ProbePolicy> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    if ([404, 405, 501].includes(response.status)) throw new Error('当前 Controller 尚不支持持久化探测配置，请先升级 Controller。');
    if (response.status === 409) throw new Error('配置已被其他管理员修改，请重新加载后再保存。');
    throw new Error(typeof data?.error === 'string' ? data.error : '无法读取或保存探测地址，请稍后重试。');
  }
  if (!data || !Array.isArray(data.allowedHosts) || data.allowedHosts.some((host: unknown) => typeof host !== 'string') || typeof data.allowPrivateNetwork !== 'boolean' || typeof data.revision !== 'string') throw new Error('Controller 返回了无效的探测配置。');
  return data;
}

export function ModelProbePolicyDialog({ onClose }: { onClose: () => void }) {
  const [policy, setPolicy] = useState<ProbePolicy | null>(null);
  const [hosts, setHosts] = useState('');
  const [allowPrivateNetwork, setAllowPrivateNetwork] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [needsReload, setNeedsReload] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const apply = (next: ProbePolicy) => {
    setPolicy(next);
    setHosts(next.allowedHosts.join('\n'));
    setAllowPrivateNetwork(next.allowPrivateNetwork);
    setNeedsReload(false);
  };
  const load = useCallback(async (signal?: AbortSignal) => {
    setLoading(true); setError(null); setSaved(false);
    try {
      const next = await readPolicy(await fetch(apiUrl(path), { cache: 'no-store', signal }));
      if (!signal?.aborted) apply(next);
    } catch (cause) {
      if (!signal?.aborted) setError(cause instanceof Error ? cause.message : '无法读取探测地址。');
    } finally { if (!signal?.aborted) setLoading(false); }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);
  const save = async () => {
    if (!policy || needsReload) return;
    setSaving(true); setError(null); setSaved(false);
    try {
      const response = await fetch(apiUrl(path), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ allowedHosts: hosts.split(/[\n,]/).map(host => host.trim()).filter(Boolean), allowPrivateNetwork, revision: policy.revision }),
      });
      if (response.status === 409) setNeedsReload(true);
      apply(await readPolicy(response));
      setSaved(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法保存探测地址。'); }
    finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={open => { if (!open && !saving) onClose(); }}>
    <DialogContent className="sm:max-w-lg">
      <DialogHeader><DialogTitle>模型探测地址</DialogTitle><DialogDescription>配置当前 Controller 允许测试的模型服务地址。保存后立即生效，重启后保留。</DialogDescription></DialogHeader>
      {loading ? <p className="text-sm text-muted-foreground">正在读取配置…</p> : null}
      {policy ? <p className="text-xs text-muted-foreground">{policy.source === 'persistent' ? '当前使用已保存的配置。' : '当前使用环境变量默认值；保存后以此配置为准。'} 公网模型服务默认可测，内网主机按下方配置放行。</p> : null}
      <div className="space-y-2">
        <Label htmlFor="probe-allowed-hosts">允许的模型服务主机</Label>
        <Textarea id="probe-allowed-hosts" rows={5} className="max-h-56 field-sizing-fixed font-mono" value={hosts} disabled={!policy || loading || saving} placeholder={'172.16.50.89\ngpu.example.local'} onChange={event => { setHosts(event.target.value); setSaved(false); }} />
        <p className="text-xs text-muted-foreground">每行一个主机名或 IP，也可用逗号分隔。不填写 http://、端口、路径或通配符。关闭「允许所有内网地址」且列表为空时，仅保留默认可测的公网地址。</p>
      </div>
      <details className="rounded-md border p-3">
        <summary className="cursor-pointer text-sm">高级选项</summary>
        <div className="mt-3 flex items-center justify-between gap-3">
          <Label htmlFor="probe-private-network">允许所有内网地址</Label>
          <Switch id="probe-private-network" checked={allowPrivateNetwork} disabled={!policy || loading || saving} onCheckedChange={checked => { setAllowPrivateNetwork(checked); setSaved(false); }} />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">开启后，内网地址不再逐个匹配上面的主机列表。</p>
      </details>
      {error ? <p role="alert" className="text-sm text-destructive break-words">{error}</p> : null}
      {saved ? <p role="status" className="text-sm text-emerald-700 dark:text-emerald-400">配置已保存，后续测试立即生效。</p> : null}
      <DialogFooter>
        <Button variant="outline" disabled={loading || saving} onClick={() => void load()}>重新加载</Button>
        <Button variant="outline" disabled={saving} onClick={onClose}>关闭</Button>
        <Button disabled={!policy || loading || saving || needsReload} onClick={() => void save()}>{saving ? '保存中…' : '保存配置'}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
