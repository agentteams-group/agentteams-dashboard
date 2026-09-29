'use client';

import { useMemo } from 'react';
import { Puzzle, Route, LayoutDashboard, Menu, ExternalLink } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BUNDLED_PLUGINS } from '@/plugins';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import { pluginSectionId } from '@/lib/plugins/types';
import { useSectionStore } from '@/lib/section-store';

interface PluginCardData {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  extensionPoints: string[];
  contributionCount: number;
  firstRouteId?: string;
}

/**
 * Plugin gallery MVP (D1 17.4): an exposure slot for plugins registered with
 * the Dashboard plugin system. Bundled plugins come from BUNDLED_PLUGINS
 * (manifest metadata); URL-loaded external plugins appear from their
 * extension-store contributions even without a bundled manifest.
 */
export function PluginGallery() {
  const menuItems = useExtensionStore((s) => s.menuItems);
  const routes = useExtensionStore((s) => s.routes);
  const widgets = useExtensionStore((s) => s.widgets);

  const cards = useMemo<PluginCardData[]>(() => {
    const countByPlugin = new Map<string, number>();
    const routeByPlugin = new Map<string, string>();
    for (const record of [...menuItems, ...routes, ...widgets]) {
      countByPlugin.set(record.pluginId, (countByPlugin.get(record.pluginId) ?? 0) + 1);
    }
    for (const record of routes) {
      if (!routeByPlugin.has(record.pluginId)) {
        routeByPlugin.set(record.pluginId, record.contribution.id);
      }
    }

    const bundled = BUNDLED_PLUGINS.map((plugin) => ({
      id: plugin.manifest.id,
      name: plugin.manifest.name,
      version: plugin.manifest.version,
      description: plugin.manifest.description,
      author: plugin.manifest.author,
      extensionPoints: [...(plugin.manifest.extensionPoints ?? [])],
      contributionCount: countByPlugin.get(plugin.manifest.id) ?? 0,
      firstRouteId: routeByPlugin.get(plugin.manifest.id),
    }));

    const bundledIds = new Set(bundled.map((c) => c.id));
    const external = [...countByPlugin.keys()]
      .filter((id) => !bundledIds.has(id))
      .map((id) => ({
        id,
        name: id,
        version: '',
        description: undefined,
        author: undefined,
        extensionPoints: [],
        contributionCount: countByPlugin.get(id) ?? 0,
        firstRouteId: routeByPlugin.get(id),
      }));

    return [...bundled, ...external];
  }, [menuItems, routes, widgets]);

  const openRoute = (pluginId: string, routeId: string) => {
    useSectionStore.getState().setActiveSection(pluginSectionId(pluginId, routeId));
  };

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        已注册插件与外部插件曝光位。外部插件经插件系统加载后在此展示其贡献（路由 / 小部件 / 菜单项）。
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {cards.map((card) => (
          <Card key={card.id} className="glass-card">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center gap-2 text-sm">
                <Puzzle className="h-4 w-4 text-primary shrink-0" />
                <span className="truncate">{card.name}</span>
                {card.version && (
                  <Badge variant="outline" className="text-[10px] shrink-0">v{card.version}</Badge>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {card.description && (
                <p className="text-xs text-muted-foreground line-clamp-2">{card.description}</p>
              )}
              <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-muted-foreground">
                {card.extensionPoints.map((point) => (
                  <Badge key={point} variant="secondary" className="text-[10px]">{point}</Badge>
                ))}
                {card.contributionCount > 0 && (
                  <Badge variant="outline" className="text-[10px]">{card.contributionCount} 项贡献</Badge>
                )}
                {card.contributionCount === 0 && (
                  <Badge variant="outline" className="text-[10px]">未激活</Badge>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 text-[10px] text-muted-foreground">
                {card.firstRouteId && (
                  <span className="inline-flex items-center gap-1">
                    <Route className="h-3 w-3" /> 路由 {card.firstRouteId}
                  </span>
                )}
                {menuItems.some((r) => r.pluginId === card.id) && (
                  <span className="inline-flex items-center gap-1">
                    <Menu className="h-3 w-3" /> 菜单项
                  </span>
                )}
                {widgets.some((r) => r.pluginId === card.id) && (
                  <span className="inline-flex items-center gap-1">
                    <LayoutDashboard className="h-3 w-3" /> 小部件
                  </span>
                )}
              </div>
              {card.firstRouteId && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-7 px-2 text-xs"
                  onClick={() => openRoute(card.id, card.firstRouteId!)}
                >
                  <ExternalLink className="mr-1 h-3 w-3" />
                  打开
                </Button>
              )}
            </CardContent>
          </Card>
        ))}
      </div>
      {cards.length === 0 && (
        <p className="py-8 text-center text-sm text-muted-foreground">暂无已注册插件</p>
      )}
    </div>
  );
}
