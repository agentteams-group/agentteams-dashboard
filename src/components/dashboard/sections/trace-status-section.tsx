'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Activity } from 'lucide-react';

export function TraceStatusSection() {
  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
              <Activity className="h-6 w-6 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold mb-1">Trace 状态</h3>
              <p className="text-sm text-muted-foreground">
                分布式追踪系统运行状态
              </p>
            </div>
            <Badge variant="default" className="ml-auto">
              正常运行
            </Badge>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1">采样率</div>
            <div className="text-2xl font-semibold">100%</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-4">
            <div className="text-sm text-muted-foreground mb-1">今日 Trace 数</div>
            <div className="text-2xl font-semibold">-</div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
