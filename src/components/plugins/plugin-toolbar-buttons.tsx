'use client';

import { Suspense } from 'react';
import { usePluginToolbarButtons } from '@/lib/plugins/extension-store';
import { usePluginRegistry } from '@/lib/plugins/registry';
import { resolvePluginIcon } from './plugin-icons';
import { PluginErrorBoundary } from './plugin-error-boundary';
import { Button } from '@/components/ui/button';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Extension point host: toolbar buttons in the dashboard header.
 */

export function PluginToolbarButtons() {
  const buttons = usePluginToolbarButtons();
  const records = usePluginRegistry((s) => s.records);

  if (buttons.length === 0) return null;

  return (
    <div className="flex items-center gap-1" data-testid="plugin-toolbar">
      {buttons.map(({ pluginId, contribution }) => {
        const Icon = resolvePluginIcon(contribution.icon);
        const pluginName = records[pluginId]?.manifest.name;

        if (contribution.component) {
          const Custom = contribution.component;
          return (
            <PluginErrorBoundary
              key={`${pluginId}:${contribution.id}`}
              pluginId={pluginId}
              pluginName={pluginName}
              variant="inline"
            >
              <Suspense fallback={null}>
                <Custom />
              </Suspense>
            </PluginErrorBoundary>
          );
        }

        return (
          <Tooltip key={`${pluginId}:${contribution.id}`}>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                data-plugin-toolbar-button={`${pluginId}:${contribution.id}`}
                onClick={() => contribution.onClick?.()}
              >
                <Icon className="h-4 w-4" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{contribution.label}</TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
