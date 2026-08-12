'use client';

import { useEffect } from 'react';
import { pluginManager } from '@/lib/plugins/manager';

/**
 * Boots the plugin system exactly once per session:
 * discovers bundled/server/url plugins, activates the enabled ones and
 * starts the dev hot-reload watcher. Safe to call from multiple components.
 */
export function usePluginSystem(): void {
  useEffect(() => {
    void pluginManager.init();
  }, []);
}
