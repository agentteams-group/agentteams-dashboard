'use client';

import { Suspense } from 'react';
import { usePluginWidgets } from '@/lib/plugins/extension-store';
import { usePluginRegistry } from '@/lib/plugins/registry';
import { PluginErrorBoundary } from './plugin-error-boundary';
import { SectionSkeleton } from '@/components/dashboard/section-skeleton';

/**
 * Extension point host: dashboard widgets (rendered on the overview page).
 * Renders nothing when no plugin contributes widgets.
 */

export function PluginWidgetsGrid() {
  const widgets = usePluginWidgets();
  const records = usePluginRegistry((s) => s.records);

  if (widgets.length === 0) return null;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4" data-testid="plugin-widgets">
      {widgets.map(({ pluginId, contribution }) => {
        const Widget = contribution.component;
        const span = contribution.size === 'lg' ? 'md:col-span-2 xl:col-span-3' : '';
        return (
          <div key={`${pluginId}:${contribution.id}`} className={span}>
            <PluginErrorBoundary
              pluginId={pluginId}
              pluginName={records[pluginId]?.manifest.name}
            >
              <Suspense fallback={<SectionSkeleton />}>
                <Widget />
              </Suspense>
            </PluginErrorBoundary>
          </div>
        );
      })}
    </div>
  );
}
