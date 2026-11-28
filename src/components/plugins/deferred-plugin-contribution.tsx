'use client';

import { useEffect, type ComponentType } from 'react';
import { useExtensionStore, type PointListKey } from '@/lib/plugins/extension-store';
import type { RouteComponentProps } from '@/lib/plugins/types';

interface DeferredContributionProps {
  pluginId: string;
  contributionId: string;
  point: PointListKey;
  fallback: ComponentType<RouteComponentProps>;
  activate: (_pluginId: string) => Promise<void>;
  routeProps?: RouteComponentProps;
}

/**
 * A manifest-declared contribution starts activation only after its host slot
 * actually renders. Navigation metadata alone never imports the plugin entry.
 */
export function DeferredPluginContribution({
  pluginId, contributionId, point, fallback: Fallback, activate, routeProps,
}: DeferredContributionProps) {
  const contribution = useExtensionStore((state) => {
    const list = state[point] as Array<{
      pluginId: string;
      contribution: { id: string; component?: ComponentType };
    }>;
    return list.find((item) => item.pluginId === pluginId && item.contribution.id === contributionId)?.contribution;
  });
  useEffect(() => {
    void activate(pluginId).catch(() => undefined);
  }, [pluginId, activate]);

  const Component = contribution?.component as ComponentType<RouteComponentProps> | undefined;
  if (!Component || Component === Fallback) return <Fallback {...(routeProps ?? { pluginId })} />;
  return <Component {...(routeProps ?? { pluginId })} />;
}
