'use client';

import { Suspense } from 'react';
import { usePluginDetailBlocks } from '@/lib/plugins/extension-store';
import { usePluginRegistry } from '@/lib/plugins/registry';
import type { DetailBlockProps, DetailEntityKind } from '@/lib/plugins/types';
import { PluginErrorBoundary } from './plugin-error-boundary';

/**
 * Extension point host: detail panel blocks.
 * Rendered inside entity detail dialogs (Worker/Team/Manager/Human); each
 * plugin contribution appears as its own labelled section.
 */

export function PluginDetailBlocks({
  entity,
  data,
}: {
  entity: DetailEntityKind;
  data: unknown;
}) {
  const blocks = usePluginDetailBlocks(entity);
  const records = usePluginRegistry((s) => s.records);

  if (blocks.length === 0) return null;

  return (
    <div className="space-y-3" data-testid="plugin-detail-blocks">
      {blocks.map(({ pluginId, contribution }) => {
        const Block = contribution.component as React.ComponentType<DetailBlockProps<unknown>>;
        return (
          <div
            key={`${pluginId}:${contribution.id}`}
            className="rounded-lg border border-border/60 p-3"
          >
            <PluginErrorBoundary
              pluginId={pluginId}
              pluginName={records[pluginId]?.manifest.name}
              variant="inline"
            >
              <Suspense fallback={<p className="text-xs text-muted-foreground">加载中…</p>}>
                <Block entity={data} />
              </Suspense>
            </PluginErrorBoundary>
          </div>
        );
      })}
    </div>
  );
}
