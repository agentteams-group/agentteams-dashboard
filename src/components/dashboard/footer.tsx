'use client';

import { Wifi, WifiOff, Activity, Globe, Clock, RefreshCw, MessageSquare } from 'lucide-react';
import { Separator } from '@/components/ui/separator';

interface DashboardFooterProps {
  isConnected: boolean;
  connectionLatency: number | null;
  controllerUrl: string;
  reconnectInterval: number;
  lastRefreshText: string;
  latencyColor: string;
  latencyText: string;
  matrixLoggedIn: boolean;
  matrixSyncing: boolean;
}

export function DashboardFooter({
  isConnected,
  connectionLatency,
  controllerUrl,
  reconnectInterval,
  lastRefreshText,
  latencyColor,
  latencyText,
  matrixLoggedIn,
  matrixSyncing,
}: DashboardFooterProps) {
  return (
    <footer className="flex h-8 shrink-0 items-center gap-3 whitespace-nowrap border-t border-border bg-card px-4 text-xs text-muted-foreground">
      <div className="flex shrink-0 items-center gap-1.5">
        {isConnected ? (
          <Wifi className="w-3 h-3 text-emerald-500" />
        ) : (
          <WifiOff className="w-3 h-3 text-amber-500" />
        )}
        <span>{isConnected ? '已连接' : '未连接'}</span>
        {isConnected && connectionLatency != null && (
          <>
            <Separator orientation="vertical" className="h-3" />
            <span className={`flex items-center gap-0.5 ${latencyColor}`}>
              <Activity className="w-3 h-3" />
              {latencyText}
            </span>
          </>
        )}
      </div>

      {controllerUrl && <>
        <Separator orientation="vertical" className="hidden h-3 md:block" />
        <div className="hidden min-w-0 max-w-[200px] items-center gap-1 md:flex" title={controllerUrl}>
          <Globe className="size-3 shrink-0" />
          <span className="truncate">{controllerUrl.replace(/^https?:\/\//, '')}</span>
        </div>
      </>}
      <Separator orientation="vertical" className="hidden h-3 md:block" />
      <div className="hidden items-center gap-1 md:flex" title="上次刷新">
        <Clock className="size-3" />
        <span>{lastRefreshText}</span>
      </div>
      <Separator orientation="vertical" className="hidden h-3 md:block" />
      <div className="hidden items-center gap-1 md:flex" title="重连间隔">
        <RefreshCw className="size-3" />
        <span>{reconnectInterval / 1000}s</span>
      </div>

      <div className="flex-1" />

      <div className="flex shrink-0 items-center gap-1.5">
        <MessageSquare className="w-3 h-3" />
        <span>
          {matrixLoggedIn
            ? matrixSyncing
              ? '消息同步中'
              : '对话已连接'
            : '对话未连接'}
        </span>
        {matrixLoggedIn && (
          <span className={`w-1.5 h-1.5 rounded-full ${matrixSyncing ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
        )}
      </div>
    </footer>
  );
}
