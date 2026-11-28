'use client';

import { useId } from 'react';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';

export function WorkerHeartbeatControl({
  enabled,
  supported = true,
  disabled,
  onCheckedChange,
}: {
  enabled?: boolean;
  supported?: boolean;
  disabled?: boolean;
  onCheckedChange: (_enabled: boolean) => void;
}) {
  const id = useId();
  return (
    <section className="space-y-2 rounded-md border p-3" aria-label="自主巡检">
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={id}>自主巡检</Label>
        <Switch
          id={id}
          checked={enabled ?? false}
          disabled={!supported || disabled || typeof enabled !== 'boolean'}
          onCheckedChange={onCheckedChange}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        定时调用模型检查待办，会产生 Token 用量。关闭后仍可处理收到的消息和任务。记忆整理等独立定时任务不受影响。
      </p>
      {!supported ? <p className="text-xs text-muted-foreground">当前运行时暂不支持自主巡检。</p> : typeof enabled !== 'boolean' ? (
        <p className="text-xs text-muted-foreground">当前 Controller 尚未提供此设置，请升级后使用。</p>
      ) : null}
    </section>
  );
}
