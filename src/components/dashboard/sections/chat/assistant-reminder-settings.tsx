'use client';

import { useEffect, useId, useState } from 'react';
import { BellRing } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { apiUrl } from '@/lib/api-base';

interface ReminderView {
  owner: string;
  revision: string;
  roomId: string;
  context: { enabled: boolean; everySeconds: number };
}

export function AssistantReminderSettings({ team, manager, roomId }: { team?: string; manager?: string; roomId: string }) {
  const [open, setOpen] = useState(false);
  const [view, setView] = useState<ReminderView | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [hours, setHours] = useState(3);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const id = useId();
  const scope = new URLSearchParams(team ? { team } : { manager: manager ?? 'default' }).toString();
  const endpoint = apiUrl(`/api/agentteams/assistant/context?${scope}`);

  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    setView(null);
    setError('');
    void (async () => {
      try {
        const response = await fetch(endpoint, { cache: 'no-store', signal: controller.signal });
        if (!response.ok) throw new Error(response.status === 403 ? '只有该会话的管理员可以调整提醒。' : '暂时无法读取提醒设置，请稍后重试。');
        const current = await response.json() as ReminderView;
        if (current.roomId !== roomId) throw new Error('会话已更新，请刷新后重新打开。');
        if (!controller.signal.aborted) {
          setView(current);
          setEnabled(current.context.enabled);
          setHours(current.context.everySeconds / 3600);
        }
      } catch (error) {
        if (!controller.signal.aborted) setError(error instanceof Error ? error.message : '读取提醒设置失败。');
      }
    })();
    return () => controller.abort();
  }, [open, endpoint, roomId]);

  async function save() {
    if (!view) return;
    setSaving(true);
    setError('');
    try {
      const response = await fetch(endpoint, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ owner: view.owner, revision: view.revision, enabled, everySeconds: Math.round(hours * 3600) }),
      });
      if (!response.ok) throw new Error(response.status === 409 ? '配置或助手已更新，请关闭后重新打开再修改。' : '提醒设置保存失败，请稍后重试。');
      setOpen(false);
    } catch (error) {
      setError(error instanceof Error ? error.message : '提醒设置保存失败。');
    } finally { setSaving(false); }
  }

  return <Popover open={open} onOpenChange={setOpen}>
    <PopoverTrigger asChild><Button size="sm" variant="ghost" aria-label="提醒设置" title="提醒设置"><BellRing className="size-4" /><span className="hidden lg:inline">提醒</span></Button></PopoverTrigger>
    <PopoverContent align="end" className="w-80 space-y-4">
      <div><h3 className="font-medium">助手提醒</h3><p className="mt-1 text-sm text-muted-foreground">定时检查你关注的内容，有新信息才在这个会话提醒你。</p></div>
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {view ? <>
        <div className="flex items-center justify-between"><label htmlFor={`${id}-enabled`} className="text-sm">定时提醒</label><Switch id={`${id}-enabled`} checked={enabled} onCheckedChange={setEnabled} disabled={saving} /></div>
        <div className="space-y-2"><label htmlFor={`${id}-hours`} className="text-sm">提醒间隔（小时）</label><Input id={`${id}-hours`} type="number" min={1 / 120} max={8760} step="any" value={hours} onChange={event => setHours(Number(event.target.value))} disabled={saving || !enabled} /></div>
        <Button className="w-full" disabled={saving || !Number.isFinite(hours) || hours < 1 / 120 || hours > 8760} onClick={() => { void save(); }}>{saving ? '保存中…' : '保存'}</Button>
      </> : !error && <p role="status" className="text-sm text-muted-foreground">正在读取提醒设置…</p>}
    </PopoverContent>
  </Popover>;
}
