'use client';

import { useState, useMemo } from 'react';
import { Download, Search, Loader2 } from 'lucide-react';
import { SectionHeader } from '@/components/dashboard/section-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { useLogs } from '@/hooks/use-agentteams-logs';

const COMPONENTS = [
  { value: 'controller', label: 'Controller' },
  { value: 'worker', label: 'Worker / Manager Pod' },
  { value: 'matrix', label: 'Matrix / Tuwunel' },
  { value: 'higress', label: 'Higress' },
  { value: 'dashboard', label: 'Dashboard' },
];

const LEVELS = ['all', 'debug', 'info', 'warn', 'error'];

const LEVEL_COLORS: Record<string, string> = {
  debug: 'bg-slate-500/10 text-slate-600',
  info: 'bg-blue-500/10 text-blue-600',
  warn: 'bg-amber-500/10 text-amber-600',
  error: 'bg-red-500/10 text-red-600',
};

export function LogsSection() {
  const [component, setComponent] = useState('controller');
  const [tail, setTail] = useState(200);
  const [level, setLevel] = useState('all');
  const [search, setSearch] = useState('');

  const { data: logs, isLoading } = useLogs(component, {
    tail,
    level: level === 'all' ? undefined : level,
  });

  const filteredLogs = useMemo(() => {
    if (!logs) return [];
    if (!search.trim()) return logs;
    const q = search.toLowerCase();
    return logs.filter(
      (line) =>
        line.message.toLowerCase().includes(q) ||
        line.component.toLowerCase().includes(q)
    );
  }, [logs, search]);

  const handleDownload = () => {
    const text = (logs || [])
      .map(
        (line) =>
          `${line.timestamp} [${line.level.toUpperCase()}] [${line.component}] ${line.message}`
      )
      .join('\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${component}-logs.txt`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="space-y-4">
      <SectionHeader
        title="系统日志"
        description="查看各组件日志，支持过滤、搜索和下载"
      />

      <div className="flex flex-col lg:flex-row items-start lg:items-end gap-3">
        <div className="space-y-2">
          <Label>组件</Label>
          <Select value={component} onValueChange={setComponent}>
            <SelectTrigger className="w-56">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPONENTS.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>级别</Label>
          <Select value={level} onValueChange={setLevel}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {LEVELS.map((l) => (
                <SelectItem key={l} value={l}>
                  {l === 'all' ? '全部' : l.toUpperCase()}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2">
          <Label>行数</Label>
          <Select value={String(tail)} onValueChange={(v) => setTail(Number(v))}>
            <SelectTrigger className="w-32">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {[100, 200, 500, 1000, 5000].map((n) => (
                <SelectItem key={n} value={String(n)}>
                  最近 {n} 行
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 flex-1 min-w-[200px]">
          <Label>搜索</Label>
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="关键字..."
              className="pl-9"
            />
          </div>
        </div>

        <Button variant="outline" size="sm" onClick={handleDownload} disabled={!logs?.length}>
          <Download className="w-4 h-4 mr-2" />
          下载
        </Button>
      </div>

      <ScrollArea className="h-[600px] rounded-md border bg-muted/20">
        <div className="p-3 font-mono text-xs space-y-1">
          {isLoading && (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              加载日志...
            </div>
          )}
          {!isLoading && filteredLogs.length === 0 && (
            <div className="text-center py-8 text-muted-foreground">
              暂无日志
            </div>
          )}
          {filteredLogs.map((line, idx) => (
            <div key={idx} className="break-words hover:bg-muted/50 rounded px-1 py-0.5">
              <span className="text-muted-foreground">{line.timestamp}</span>{' '}
              <Badge
                variant="secondary"
                className={`text-[10px] px-1 py-0 ${LEVEL_COLORS[line.level.toLowerCase()] || ''}`}
              >
                {line.level.toUpperCase()}
              </Badge>{' '}
              <span className="text-muted-foreground">[{line.component}]</span>{' '}
              <span className="text-foreground">{line.message}</span>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
}
