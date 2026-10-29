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
    <footer className="h-7 border-t border-border bg-card/80 backdrop-blur-sm flex items-center px-3 gap-3 text-xs text-muted-foreground flex-shrink-0">
      <div className="flex items-center gap-1.5">
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

      <Separator orientation="vertical" className="h-3" />

      <div className="flex items-center gap-1 min-w-0 max-w-[200px]">
        <Globe className="w-3 h-3 flex-shrink-0" />
        <span className="truncate">{controllerUrl.replace(/^https?:\/\//, '')}</span>
      </div>

      <Separator orientation="vertical" className="h-3" />

      <div className="flex items-center gap-1">
        <Clock className="w-3 h-3" />
        <span>{lastRefreshText}</span>
      </div>

      <Separator orientation="vertical" className="h-3" />

      <div className="flex items-center gap-1">
        <RefreshCw className="w-3 h-3" />
        <span>{reconnectInterval / 1000}s</span>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-1.5">
        <MessageSquare className="w-3 h-3" />
        <span>
          {matrixLoggedIn
            ? matrixSyncing
              ? 'Matrix 同步中'
              : 'Matrix 已连接'
            : 'Matrix 未连接'}
        </span>
        {matrixLoggedIn && (
          <span className={`w-1.5 h-1.5 rounded-full ${matrixSyncing ? 'bg-amber-500 animate-pulse' : 'bg-emerald-500'}`} />
        )}
      </div>
    </footer>
  );
}
