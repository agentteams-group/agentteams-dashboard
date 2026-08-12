'use client';

import { apiUrl } from '@/lib/api-base';
import { BUNDLED_PLUGINS } from '@/plugins';
import { createPluginApi, DASHBOARD_VERSION } from './api';
import { HOST_EVENTS, pluginEventBus } from './event-bus';
import { fetchManifestJson, hashString, loadUrlPluginModule, resolveEntryUrl } from './loader';
import { validatePluginManifest, PluginManifestError } from './manifest';
import { makePluginRecord, usePluginRegistry } from './registry';
import { purgePluginState } from './sandbox';
import { useExtensionStore } from './extension-store';
import { installPluginHost } from './host';
import type {
  PluginModule,
  PluginRecord,
  Unregister,
} from './types';

/**
 * Plugin lifecycle orchestrator.
 *
 * install → load → activate → deactivate → uninstall
 *
 * Failures are contained: a broken plugin is marked `error` and skipped;
 * the Dashboard shell never throws because of plugin code.
 */

interface ServerPluginIndex {
  plugins: Array<{ manifestUrl: string }>;
}

export class PluginManager {
  private unregisters = new Map<string, Unregister[]>();
  private deactivateFns = new Map<string, () => void | Promise<void>>();
  private reloadTokens = new Map<string, number>();
  private entryHashes = new Map<string, string>();
  private initPromise: Promise<void> | null = null;
  private devWatcher: ReturnType<typeof setInterval> | null = null;

  /** Idempotent bootstrap: discover + activate all configured plugins. */
  init(): Promise<void> {
    if (!this.initPromise) {
      this.initPromise = this.doInit();
    }
    return this.initPromise;
  }

  private async doInit(): Promise<void> {
    installPluginHost();

    // 1. Bundled plugins compiled into the Dashboard.
    for (const source of BUNDLED_PLUGINS) {
      const record = makePluginRecord(source.manifest, {
        kind: 'bundled',
        load: source.load as () => Promise<PluginModule>,
      });
      usePluginRegistry.getState().upsertRecord(record);
    }

    // 2. User-installed URL plugins (persisted manifest URLs).
    const { installedUrls } = usePluginRegistry.getState();
    await Promise.allSettled(
      installedUrls.map((url) => this.installFromUrl(url, { persist: false }))
    );

    // 3. Plugins served from the Dashboard's own public/ directory.
    await this.discoverServerPlugins();

    // 4. Dev-mode manifest URLs from the environment (scaffold CLI workflow).
    const devUrls = (process.env.NEXT_PUBLIC_PLUGIN_DEV_URLS || '')
      .split(',')
      .map((u) => u.trim())
      .filter(Boolean);
    await Promise.allSettled(
      devUrls.map((url) => this.installFromUrl(url, { persist: false }))
    );

    // 5. Activate everything the user has not disabled.
    await this.activateEnabled();

    usePluginRegistry.getState().setReady(true);

    if (process.env.NODE_ENV === 'development') {
      this.startDevReloadWatcher();
    }
  }

  private async discoverServerPlugins(): Promise<void> {
    try {
      const res = await fetch(apiUrl('/api/dashboard/plugins'), {
        credentials: 'same-origin',
      });
      if (!res.ok) return;
      const index = (await res.json()) as ServerPluginIndex;
      if (!index || !Array.isArray(index.plugins)) return;
      await Promise.allSettled(
        index.plugins
          .filter((p) => typeof p?.manifestUrl === 'string')
          .map((p) => this.installFromUrl(p.manifestUrl, { persist: false }))
      );
    } catch {
      // Server plugin index is optional; ignore failures.
    }
  }

  private async activateEnabled(): Promise<void> {
    const { records, disabledIds } = usePluginRegistry.getState();
    await Promise.allSettled(
      Object.values(records)
        .filter((r) => !disabledIds.includes(r.manifest.id))
        .map((r) => this.activate(r.manifest.id))
    );
  }

  /** Install a plugin from a plugin.json URL. */
  async installFromUrl(
    manifestUrl: string,
    options: { persist?: boolean } = {}
  ): Promise<PluginRecord> {
    const { persist = true } = options;
    const registry = usePluginRegistry.getState();

    const raw = await fetchManifestJson(manifestUrl);
    const manifest = validatePluginManifest(raw, { dashboardVersion: DASHBOARD_VERSION });

    const existing = registry.records[manifest.id];
    if (existing && existing.source.kind === 'url' && existing.source.manifestUrl === manifestUrl) {
      // Same source: refresh metadata only.
      const refreshed: PluginRecord = { ...existing, manifest };
      registry.upsertRecord(refreshed);
      if (persist) registry.addInstalledUrl(manifestUrl);
      return refreshed;
    }
    if (existing) {
      throw new PluginManifestError(
        `插件 id "${manifest.id}" 已被占用（来源不同）。请先卸载旧插件。`
      );
    }

    const record = makePluginRecord(manifest, { kind: 'url', manifestUrl });
    usePluginRegistry.getState().upsertRecord(record);
    if (persist) usePluginRegistry.getState().addInstalledUrl(manifestUrl);

    if (!usePluginRegistry.getState().disabledIds.includes(manifest.id)) {
      await this.activate(manifest.id);
    }
    return usePluginRegistry.getState().records[manifest.id];
  }

  /** Load + activate a registered plugin. */
  async activate(id: string): Promise<void> {
    const registry = usePluginRegistry.getState();
    const record = registry.records[id];
    if (!record) throw new Error(`插件未安装: ${id}`);
    if (record.status === 'active') return;
    if (registry.disabledIds.includes(id)) return;

    registry.updateStatus(id, 'enabled');
    this.unregisters.set(id, []);

    try {
      const mod = await this.loadModule(record);
      const activator = mod.default ?? mod;
      if (typeof activator.activate !== 'function') {
        throw new Error(`插件 ${id}: 入口模块缺少 activate() 导出`);
      }

      const api = createPluginApi({
        manifest: record.manifest,
        trackUnregister: (fn) => {
          this.unregisters.get(id)?.push(fn);
        },
      });

      await activator.activate(api);

      if (typeof activator.deactivate === 'function') {
        this.deactivateFns.set(id, activator.deactivate.bind(activator));
      }
      usePluginRegistry.getState().updateStatus(id, 'active');
      pluginEventBus.emit(HOST_EVENTS.pluginActivated, { pluginId: id });
    } catch (err) {
      // Contain the failure: clean partial contributions, mark error.
      this.cleanupContributions(id);
      const message = err instanceof Error ? err.message : String(err);
      usePluginRegistry.getState().updateStatus(id, 'error', message);
      pluginEventBus.emit(HOST_EVENTS.pluginError, { pluginId: id, error: message });
      console.error(`[plugins] 插件 ${id} 激活失败:`, err);
      throw err;
    }
  }

  private async loadModule(record: PluginRecord): Promise<PluginModule> {
    if (record.source.kind === 'bundled') {
      if (!record.source.load) throw new Error(`插件 ${record.manifest.id}: bundled 来源缺少 load`);
      return await record.source.load();
    }
    if (!record.source.manifestUrl) {
      throw new Error(`插件 ${record.manifest.id}: url 来源缺少 manifestUrl`);
    }
    const token = this.reloadTokens.get(record.manifest.id);
    return await loadUrlPluginModule(
      record.source.manifestUrl,
      record.manifest.entry.dashboard!,
      token
    );
  }

  /** Deactivate: run plugin teardown + force-remove all contributions. */
  async deactivate(id: string): Promise<void> {
    const deactivate = this.deactivateFns.get(id);
    if (deactivate) {
      try {
        await deactivate();
      } catch (err) {
        console.warn(`[plugins] 插件 ${id} deactivate() 出错:`, err);
      }
      this.deactivateFns.delete(id);
    }
    this.cleanupContributions(id);
    pluginEventBus.emit(HOST_EVENTS.pluginDeactivated, { pluginId: id });
  }

  private cleanupContributions(id: string): void {
    const fns = this.unregisters.get(id) ?? [];
    for (const fn of [...fns].reverse()) {
      try {
        fn();
      } catch (err) {
        console.warn(`[plugins] 插件 ${id} 注销扩展项出错:`, err);
      }
    }
    this.unregisters.delete(id);
    useExtensionStore.getState().removePlugin(id);
  }

  async enable(id: string): Promise<void> {
    usePluginRegistry.getState().setDisabled(id, false);
    await this.activate(id);
  }

  async disable(id: string): Promise<void> {
    usePluginRegistry.getState().setDisabled(id, true);
    await this.deactivate(id);
    usePluginRegistry.getState().updateStatus(id, 'disabled');
  }

  async uninstall(id: string): Promise<void> {
    const registry = usePluginRegistry.getState();
    const record = registry.records[id];
    if (!record) return;
    await this.deactivate(id);
    if (record.source.manifestUrl) {
      registry.removeInstalledUrl(record.source.manifestUrl);
    }
    registry.removeRecord(id);
    purgePluginState(id);
    this.reloadTokens.delete(id);
    this.entryHashes.delete(id);
  }

  /** Re-load + re-activate (dev hot reload). */
  async reload(id: string): Promise<void> {
    const registry = usePluginRegistry.getState();
    const record = registry.records[id];
    if (!record) return;
    const wasActive = record.status === 'active';
    const wasDisabled = registry.disabledIds.includes(id);
    await this.deactivate(id);
    this.reloadTokens.set(id, Date.now());
    // deactivate() leaves the stale 'active' status; reset it so activate()
    // re-runs instead of early-returning.
    usePluginRegistry.getState().updateStatus(id, 'installed');
    if (wasActive && !wasDisabled) {
      try {
        await this.activate(id);
      } catch {
        // activate() already recorded the error status.
      }
    }
  }

  /**
   * Dev-mode hot reload: poll URL plugin entry files; when the content hash
   * changes, reload the plugin without a full page refresh.
   */
  startDevReloadWatcher(intervalMs = 3000): void {
    if (this.devWatcher) return;
    this.devWatcher = setInterval(() => {
      void this.pollForChanges();
    }, intervalMs);
  }

  stopDevReloadWatcher(): void {
    if (this.devWatcher) {
      clearInterval(this.devWatcher);
      this.devWatcher = null;
    }
  }

  private async pollForChanges(): Promise<void> {
    const { records } = usePluginRegistry.getState();
    await Promise.allSettled(
      Object.values(records)
        .filter((r) => r.source.kind === 'url' && r.source.manifestUrl && r.status !== 'error')
        .map(async (record) => {
          const entryUrl = resolveEntryUrl(
            record.source.manifestUrl!,
            record.manifest.entry.dashboard!
          );
          const res = await fetch(entryUrl, { cache: 'no-store' });
          if (!res.ok) return;
          const text = await res.text();
          const digest = hashString(text);
          const previous = this.entryHashes.get(record.manifest.id);
          this.entryHashes.set(record.manifest.id, digest);
          if (previous && previous !== digest) {
            console.warn(`[plugins] 检测到插件 ${record.manifest.id} 更新,自动热重载`);
            await this.reload(record.manifest.id);
          }
        })
    );
  }

  /** Reset all in-memory state (tests). */
  resetForTests(): void {
    this.stopDevReloadWatcher();
    this.unregisters.clear();
    this.deactivateFns.clear();
    this.reloadTokens.clear();
    this.entryHashes.clear();
    this.initPromise = null;
  }
}

export const pluginManager = new PluginManager();

/** Convenience hook-style accessor for components. */
export function getPluginManager(): PluginManager {
  return pluginManager;
}
