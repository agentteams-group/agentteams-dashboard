'use client';

import { useState } from 'react';
import { FileDown, Loader2, MessageSquareText, ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { toast } from 'sonner';
import { apiUrl } from '@/lib/api-base';
import { useMatrixStore } from '@/lib/matrix-store';

const RANGE_OPTIONS = [
  { value: '10m', label: '最近 10 分钟' },
  { value: '30m', label: '最近 30 分钟' },
  { value: '1h', label: '最近 1 小时' },
  { value: '6h', label: '最近 6 小时' },
  { value: '1d', label: '最近 1 天' },
];

function filenameFromDisposition(disposition: string | null): string | null {
  if (!disposition) return null;
  const match = /filename="?([^";]+)"?/.exec(disposition);
  return match?.[1] ?? null;
}

export function DebugLogTab() {
  const [range, setRange] = useState('1h');
  const [redact, setRedact] = useState(true);
  const [container, setContainer] = useState('');
  const [room, setRoom] = useState('');
  const [collecting, setCollecting] = useState(false);

  const { isLoggedIn, accessToken, homeserver } = useMatrixStore();
  const matrixReady = isLoggedIn && !!accessToken && !!homeserver;

  const handleCollect = async () => {
    setCollecting(true);
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (matrixReady) {
        headers['Authorization'] = `Bearer ${accessToken}`;
      }
      const res = await fetch(apiUrl('/api/agentteams/debug-log'), {
        method: 'POST',
        headers,
        body: JSON.stringify({
          range,
          redact,
          container: container.trim() || undefined,
          room: room.trim() || undefined,
          homeserver: matrixReady ? homeserver : undefined,
        }),
      });

      if (!res.ok) {
        let message = `HTTP ${res.status}`;
        try {
          const data = await res.json();
          if (data?.error) message = data.error;
        } catch {
          // Non-JSON error body — keep the HTTP status message.
        }
        throw new Error(message);
      }

      const blob = await res.blob();
      const filename =
        filenameFromDisposition(res.headers.get('content-disposition')) ??
        `agentteams-debug-log-${Date.now()}.zip`;

      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(`日志包已下载：${filename}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '收集日志失败');
    } finally {
      setCollecting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        一键收集集群调试日志并打包下载 ZIP，包含容器状态与日志、Agent
        会话记录，以及（已登录 Matrix 时）房间消息。用于提交 issue 或离线排查。
      </p>

      <div className="space-y-2">
        <Label>时间范围</Label>
        <Select value={range} onValueChange={setRange}>
          <SelectTrigger className="w-64">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {RANGE_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-2">
          <Label>容器过滤（可选）</Label>
          <Input
            value={container}
            onChange={(e) => setContainer(e.target.value)}
            placeholder="例如 agentteams-worker"
          />
        </div>
        <div className="space-y-2">
          <Label>房间过滤（可选）</Label>
          <Input
            value={room}
            onChange={(e) => setRoom(e.target.value)}
            placeholder="例如 Worker"
          />
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div>
          <Label className="flex items-center gap-1.5">
            <ShieldCheck className="w-3.5 h-3.5" />
            PII 脱敏
          </Label>
          <p className="text-xs text-muted-foreground">
            自动屏蔽手机号、邮箱、API Key、Token 等敏感信息（建议保持开启）
          </p>
        </div>
        <Switch checked={redact} onCheckedChange={setRedact} />
      </div>

      <div className="flex items-center gap-2 text-xs rounded-lg border p-2.5 bg-muted/50">
        <MessageSquareText className="w-3.5 h-3.5 shrink-0" />
        {matrixReady ? (
          <span>已登录 Matrix，日志包将包含房间消息。</span>
        ) : (
          <span className="text-muted-foreground">
            未登录 Matrix，将跳过房间消息导出（仅收集容器日志与会话）。
          </span>
        )}
      </div>

      <Button onClick={handleCollect} disabled={collecting} className="w-full sm:w-auto">
        {collecting ? (
          <Loader2 className="w-4 h-4 mr-2 animate-spin" />
        ) : (
          <FileDown className="w-4 h-4 mr-2" />
        )}
        {collecting ? '正在收集，请稍候…' : '一键收集并下载'}
      </Button>
    </div>
  );
}
