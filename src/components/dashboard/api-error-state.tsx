'use client';

import { useState } from 'react';
import { WifiOff, Settings, RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useQueryClient } from '@tanstack/react-query';

interface ApiErrorStateProps {
  message?: string;
  onRetry?: () => void;
}

export function ApiErrorState({ message, onRetry }: ApiErrorStateProps) {
  const { openSettings } = useAgentTeamsStore();
  const queryClient = useQueryClient();
  const [isRefreshing, setIsRefreshing] = useState(false);

  const handleRetry = async () => {
    setIsRefreshing(true);
    try {
      if (onRetry) {
        onRetry();
      } else {
        queryClient.invalidateQueries();
      }
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4">
      <div className="w-16 h-16 rounded-full bg-amber-500/10 flex items-center justify-center mb-4">
        <WifiOff className="w-8 h-8 text-amber-500" />
      </div>
      <p className="text-lg font-medium mb-1">未连接到 AgentTeams Controller</p>
      <p className="text-sm text-muted-foreground mb-6 text-center max-w-md">
        {message || '无法连接到 AgentTeams Controller，请检查网络连接和 Controller 地址配置'}
      </p>
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" onClick={openSettings}>
          <Settings className="w-4 h-4 mr-1.5" />
          连接设置
        </Button>
        <Button variant="outline" size="sm" onClick={handleRetry} disabled={isRefreshing}>
          <RefreshCw className={`w-4 h-4 mr-1.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          重试
        </Button>
      </div>
    </div>
  );
}
