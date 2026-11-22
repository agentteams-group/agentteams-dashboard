'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

interface SectionHeaderProps {
  title: string;
  description?: string;
  isLive?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  actions?: React.ReactNode;
  meta?: React.ReactNode;
}

export function SectionHeader({ title, description, isLive, onRefresh, isRefreshing, actions, meta }: SectionHeaderProps) {
  return (
    <div data-slot="section-header" className="flex flex-wrap items-center gap-3">
      <h1 className="sr-only">{title}</h1>
      {description && <p className="w-full text-xs leading-5 text-muted-foreground">{description}</p>}
        {isLive && (
          <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-600 dark:text-emerald-400 gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            实时
          </Badge>
        )}
      {meta}
      <div className="flex flex-wrap items-center gap-2">
        {onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-sm"
            onClick={onRefresh}
            disabled={isRefreshing}
          >
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${isRefreshing ? 'animate-spin' : ''}`} />
            刷新
          </Button>
        )}
        {actions}
      </div>
    </div>
  );
}
