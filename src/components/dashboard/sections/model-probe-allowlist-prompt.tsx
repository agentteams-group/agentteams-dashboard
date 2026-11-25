'use client';
import { useState } from 'react';
import { apiUrl } from '@/lib/api-base';
import { MODEL_PROBE_POLICY_PATH, parseModelProbePolicy } from '@/lib/model-probe-policy';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

export function ModelProbeAllowlistPrompt({ host, onRetry }: { host: string; onRetry: () => void | Promise<void> }) {
  const [open, setOpen] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const approve = async () => {
    setSaving(true); setError(null);
    try {
      const policy = await parseModelProbePolicy(await fetch(apiUrl(MODEL_PROBE_POLICY_PATH), { cache: 'no-store' }));
      if (!policy.allowedHosts.some(value => value.toLowerCase() === host.toLowerCase())) {
        await parseModelProbePolicy(await fetch(apiUrl(MODEL_PROBE_POLICY_PATH), {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ allowedHosts: [...policy.allowedHosts, host], allowPrivateNetwork: policy.allowPrivateNetwork, revision: policy.revision }),
        }));
      }
      setOpen(false);
      await onRetry();
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法加入内网白名单，请重试。'); }
    finally { setSaving(false); }
  };
  return <AlertDialog open={open} onOpenChange={next => { if (!saving) setOpen(next); }}>
    <AlertDialogContent>
      <AlertDialogHeader><AlertDialogTitle>加入内网白名单？</AlertDialogTitle><AlertDialogDescription>
        模型连接测试被内网访问规则拦截。是否将主机 <strong className="break-all text-foreground">{host}</strong> 加入内网白名单，并重新测试当前模型？
      </AlertDialogDescription></AlertDialogHeader>
      {error ? <p role="alert" className="text-sm text-destructive break-words">{error}</p> : null}
      <AlertDialogFooter><AlertDialogCancel disabled={saving}>取消</AlertDialogCancel><AlertDialogAction disabled={saving} onClick={event => { event.preventDefault(); void approve(); }}>{saving ? '正在加入…' : '加入并重试'}</AlertDialogAction></AlertDialogFooter>
    </AlertDialogContent>
  </AlertDialog>;
}
