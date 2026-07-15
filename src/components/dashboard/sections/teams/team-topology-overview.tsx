'use client';

import { Bot, Crown, Users } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

export function TopologyOverview() {
  return (
    <Card className="glass-card">
      <CardContent className="p-4">
        <h3 className="text-sm font-semibold mb-3">通信拓扑</h3>
        <div className="flex items-center justify-center gap-4 py-4 flex-wrap">
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-purple-500/40 bg-purple-500/10">
              <Crown className="w-4 h-4 text-purple-500" aria-hidden="true" />
              <span className="text-sm">Manager</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">协调调度</p>
          </div>
          <svg width="40" height="24" viewBox="0 0 40 24" className="shrink-0">
            <line x1="0" y1="12" x2="32" y2="12" stroke="currentColor" strokeWidth="1.5" className="text-purple-500/40" />
            <polygon points="32,6 40,12 32,18" className="fill-purple-500/40" />
          </svg>
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-emerald-500/40 bg-emerald-500/10">
              <Users className="w-4 h-4 text-emerald-500" aria-hidden="true" />
              <span className="text-sm">Teams</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">团队房间</p>
          </div>
          <svg width="40" height="24" viewBox="0 0 40 24" className="shrink-0">
            <line x1="0" y1="12" x2="32" y2="12" stroke="currentColor" strokeWidth="1.5" className="text-emerald-500/40" />
            <polygon points="32,6 40,12 32,18" className="fill-emerald-500/40" />
          </svg>
          <div className="flex flex-col items-center">
            <div className="flex items-center gap-2 px-3 py-2 rounded-xl border-2 border-primary/40 bg-primary/10">
              <Bot className="w-4 h-4 text-primary" aria-hidden="true" />
              <span className="text-sm">Workers</span>
            </div>
            <p className="text-[10px] text-muted-foreground mt-1">执行任务</p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
