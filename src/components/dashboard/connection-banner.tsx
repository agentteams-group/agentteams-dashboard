'use client';

import { useState, useEffect, useCallback } from 'react';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { WifiOff, Settings, RefreshCw, Clock, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function ConnectionBanner() {
  const {
    isConnected,
    isChecking,
    connectionError,
    controllerUrl,
    autoReconnect,
    reconnectInterval,
    checkConnection,
    openSettings,
  } = useAgentTeamsStore();

  const intervalSec = Math.round(reconnectInterval / 1000);
  const [countdown, setCountdown] = useState(intervalSec);

  // Tick every second when disconnected, recomputing the countdown from
  // elapsed time (start time stays local to the effect — no refs in render)
  useEffect(() => {
    if (isConnected || !autoReconnect) {
      return undefined;
    }

    const startTime = Date.now();

    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTime) / 1000);
      const remaining = intervalSec - (elapsed % intervalSec);
      setCountdown(remaining === intervalSec ? intervalSec : remaining);
    }, 1000);

    return () => clearInterval(timer);
  }, [isConnected, autoReconnect, intervalSec]);

  const handleRetry = useCallback(() => {
    checkConnection();
  }, [checkConnection]);

  if (isConnected) return null;

  return (
    <div className="bg-amber-500/10 border-b border-amber-500/20 px-4 py-2 flex items-center justify-between gap-2">
      <div className="flex items-center gap-2 text-sm text-amber-600 dark:text-amber-400 min-w-0">
        <WifiOff className="w-4 h-4 shrink-0" />
        <span className="font-medium shrink-0">未连接到 AgentTeams Controller</span>
        <span className="text-amber-500/70 truncate text-xs">({controllerUrl})</span>
        {connectionError && (
          <span className="text-amber-500/70 text-xs shrink-0">- {connectionError}</span>
        )}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {/* Auto-reconnect indicator */}
        {autoReconnect && !isChecking && countdown > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-amber-500/80">
            <Clock className="w-3 h-3" />
            <span>{countdown}s</span>
          </div>
        )}
        {isChecking && (
          <div className="flex items-center gap-1.5 text-xs text-amber-500/80">
            <Loader2 className="w-3 h-3 animate-spin" />
            <span>连接中...</span>
          </div>
        )}
        <Button
          variant="outline"
          size="sm"
          onClick={handleRetry}
          disabled={isChecking}
          className="h-7 text-xs border-amber-500/30 text-amber-600 hover:bg-amber-500/10 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-300"
        >
          <RefreshCw className={`w-3 h-3 mr-1 ${isChecking ? 'animate-spin' : ''}`} />
          重试
        </Button>
        <Button variant="outline" size="sm" onClick={openSettings} className="h-7 text-xs">
          <Settings className="w-3 h-3 mr-1" />
          设置
        </Button>
      </div>
    </div>
  );
}
