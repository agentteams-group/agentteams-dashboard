import type { PluginManifest, PluginModule } from '@/lib/plugins/types';
import { manifest as monitorPanelManifest } from './monitor-panel/manifest';
import { manifest as wenTianManifest } from './wen-tian/manifest';

/**
 * Bundled plugin registry.
 *
 * Bundled plugins compile into the Dashboard bundle but still load lazily
 * (dynamic import) and run through the exact same manifest/activation flow
 * as URL plugins, so the full lifecycle stays testable end to end.
 */

export interface BundledPluginSource {
  manifest: PluginManifest;
  load: () => Promise<PluginModule>;
}

export const BUNDLED_PLUGINS: BundledPluginSource[] = [
  {
    manifest: monitorPanelManifest,
    load: () => import('./monitor-panel') as Promise<PluginModule>,
  },
  {
    manifest: wenTianManifest,
    load: () => import('./wen-tian') as Promise<PluginModule>,
  },
];
