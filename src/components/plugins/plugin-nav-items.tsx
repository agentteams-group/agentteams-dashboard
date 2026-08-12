'use client';

import { usePluginMenuItems } from '@/lib/plugins/extension-store';
import { pluginSectionId, type MenuItemContribution } from '@/lib/plugins/types';
import { resolvePluginIcon } from './plugin-icons';
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from '@/components/ui/tooltip';

/**
 * Extension point host: sidebar menu items contributed by plugins.
 * Rendered as their own "插件" group at the bottom of the navigation.
 */

export interface PluginNavItemsProps {
  activeSection: string;
  collapsed: boolean;
  onNavClick: (_sectionId: string) => void;
}

function targetSectionId(pluginId: string, item: MenuItemContribution): string | null {
  if (item.target.type === 'plugin-route') {
    return pluginSectionId(pluginId, item.target.routeId);
  }
  if (item.target.type === 'section') {
    return item.target.sectionId;
  }
  return null;
}

export function PluginNavItems({ activeSection, collapsed, onNavClick }: PluginNavItemsProps) {
  const items = usePluginMenuItems();

  if (items.length === 0) return null;

  return (
    <div data-testid="plugin-nav-group">
      {!collapsed && (
        <div className="px-4 py-2 text-[11px] font-semibold text-muted-foreground/70 uppercase tracking-wider">
          插件
        </div>
      )}
      {items.map(({ pluginId, contribution }) => {
        const Icon = resolvePluginIcon(contribution.icon);
        const sectionTarget = targetSectionId(pluginId, contribution);
        const isActive = sectionTarget !== null && activeSection === sectionTarget;

        const button = (
          <button
            onClick={() => {
              if (contribution.target.type === 'href') {
                window.open(contribution.target.url, '_blank', 'noopener,noreferrer');
                return;
              }
              if (sectionTarget) onNavClick(sectionTarget);
            }}
            data-nav-section={sectionTarget ?? undefined}
            data-plugin-menu-item={`${pluginId}:${contribution.id}`}
            className={`w-full flex items-center gap-3 px-4 py-2.5 text-sm transition-all duration-200 relative ${
              isActive
                ? 'bg-primary/10 text-primary font-medium border-r-2 border-primary'
                : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
            }`}
            title={collapsed ? contribution.label : undefined}
          >
            <Icon className="w-5 h-5 flex-shrink-0" />
            {!collapsed && <span className="truncate">{contribution.label}</span>}
          </button>
        );

        if (collapsed) {
          return (
            <Tooltip key={`${pluginId}:${contribution.id}`}>
              <TooltipTrigger asChild>{button}</TooltipTrigger>
              <TooltipContent side="right">{contribution.label}</TooltipContent>
            </Tooltip>
          );
        }
        return <div key={`${pluginId}:${contribution.id}`}>{button}</div>;
      })}
    </div>
  );
}
