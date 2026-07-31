'use client';

import { RefreshCw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ContextualHelpPopover } from '@/components/dashboard/contextual-help-popover';
import type { HelpContent } from '@/lib/help-content';

interface SectionHeaderProps {
  title: string;
  description?: string;
  isLive?: boolean;
  onRefresh?: () => void;
  isRefreshing?: boolean;
  actions?: React.ReactNode;
  helpContent?: HelpContent;
}

export function SectionHeader({ title, description, isLive, onRefresh, isRefreshing, actions, helpContent }: SectionHeaderProps) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div className="flex items-center gap-2">
        <div>
          <h1 className="text-2xl font-bold">{title}</h1>
          {description && <p className="text-muted-foreground text-sm">{description}</p>}
        </div>
        {isLive && (
          <Badge variant="outline" className="text-xs border-emerald-500/30 text-emerald-600 dark:text-emerald-400 gap-1">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
            实时
          </Badge>
        )}
      </div>
      <div className="flex items-center gap-2">
        {helpContent && <ContextualHelpPopover content={helpContent} />}
        {onRefresh && (
          <Button
            variant="ghost"
            size="sm"
            className="h-8 text-xs"
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
