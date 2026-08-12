'use client';

import { Suspense } from 'react';
import { Puzzle } from 'lucide-react';
import { usePluginRoutes } from '@/lib/plugins/extension-store';
import { usePluginRegistry } from '@/lib/plugins/registry';
import { parsePluginSectionId } from '@/lib/plugins/types';
import { PluginErrorBoundary } from './plugin-error-boundary';
import { SectionSkeleton } from '@/components/dashboard/section-skeleton';

/**
 * Extension point host: standalone plugin pages.
 * The dashboard shell routes section ids of the form
 * `plugin-route:<pluginId>/<routeId>` here.
 */

export function PluginRouteView({ sectionId }: { sectionId: string }) {
  const routes = usePluginRoutes();
  const records = usePluginRegistry((s) => s.records);
  const parsed = parsePluginSectionId(sectionId);

  if (!parsed) {
    return <PluginRouteMissing message="无效的插件页面地址" />;
  }

  const record = routes.find(
    (r) => r.pluginId === parsed.pluginId && r.contribution.id === parsed.routeId
  );

  if (!record) {
    return (
      <PluginRouteMissing
        message={`插件页面不存在或插件未启用（${parsed.pluginId}/${parsed.routeId}）`}
      />
    );
  }

  const Page = record.contribution.component;
  const pluginName = records[parsed.pluginId]?.manifest.name;

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h1 className="text-lg font-semibold">{record.contribution.title}</h1>
      </div>
      <PluginErrorBoundary pluginId={parsed.pluginId} pluginName={pluginName}>
        <Suspense fallback={<SectionSkeleton />}>
          <Page pluginId={parsed.pluginId} />
        </Suspense>
      </PluginErrorBoundary>
    </div>
  );
}

function PluginRouteMissing({ message }: { message: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <div className="w-14 h-14 rounded-full bg-muted flex items-center justify-center mb-4">
        <Puzzle className="w-7 h-7 text-muted-foreground" />
      </div>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
