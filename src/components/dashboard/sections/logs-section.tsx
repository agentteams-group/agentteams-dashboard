'use client';

import { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useLogs } from '@/hooks/use-agentteams-logs';

const COMPONENTS = [
  { value: 'controller', label: 'Controller' },
  { value: 'worker', label: 'Worker' },
  { value: 'manager', label: 'Manager' },
  { value: 'matrix', label: 'Matrix' },
  { value: 'higress', label: 'Higress' },
  { value: 'minio', label: 'MinIO' },
];

export function LogsSection() {
  const [component, setComponent] = useState('controller');
  const { data: logs = [], isLoading } = useLogs(component, { tail: 100 });

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-sm text-muted-foreground">组件:</span>
          <Select value={component} onValueChange={setComponent}>
            <SelectTrigger className="w-[180px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COMPONENTS.map((c) => (
                <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <Card>
        <CardContent className="p-0">
          <ScrollArea className="h-[600px] w-full rounded-md border p-4">
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : logs.length === 0 ? (
              <div className="text-center py-8 text-sm text-muted-foreground">
                暂无日志
              </div>
            ) : (
              <div className="space-y-1 font-mono text-xs">
                {logs.map((log, idx) => (
                  <div key={idx} className="flex gap-3 py-1 border-b border-border/50">
                    <span className="text-muted-foreground shrink-0">{log.timestamp}</span>
                    <span className={`shrink-0 w-16 ${
                      log.level === 'error' ? 'text-red-500' :
                      log.level === 'warn' ? 'text-amber-500' :
                      'text-emerald-500'
                    }`}>{log.level.toUpperCase()}</span>
                    <span className="flex-1 break-all">{log.message}</span>
                  </div>
                ))}
              </div>
            )}
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
