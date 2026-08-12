import type { PluginModule } from './types';

/**
 * Dynamic plugin module loading.
 *
 * Bundled plugins use normal (webpack-processed) dynamic imports provided by
 * their source factory. URL plugins are loaded with a bundler-independent
 * `import()` so arbitrary dev-server / static URLs work without extra build
 * configuration (see decision: runtime dynamic import, no Module Federation).
 */

/** Bypass the bundler's static import analysis for runtime URLs. */
const runtimeImport = new Function('url', 'return import(url)') as (
  _url: string
) => Promise<unknown>;

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:/i;

function currentOrigin(): string {
  if (typeof window !== 'undefined' && window.location?.origin) {
    return window.location.origin;
  }
  return 'http://localhost';
}

/**
 * Resolves a plugin entry against its manifest URL.
 * Handles absolute entries, absolute manifest URLs, and same-origin relative
 * manifest URLs (plugins served from the Dashboard's own public/ directory).
 */
export function resolveEntryUrl(manifestUrl: string, entry: string): string {
  if (URL_SCHEME.test(entry)) {
    return new URL(entry).toString();
  }
  const base = URL_SCHEME.test(manifestUrl)
    ? manifestUrl
    : new URL(manifestUrl, currentOrigin()).toString();
  return new URL(entry, base).toString();
}

export async function loadUrlPluginModule(
  manifestUrl: string,
  entry: string,
  reloadToken?: number
): Promise<PluginModule> {
  let url = resolveEntryUrl(manifestUrl, entry);
  if (reloadToken !== undefined) {
    const parsed = new URL(url);
    parsed.searchParams.set('__at_reload', String(reloadToken));
    url = parsed.toString();
  }
  const mod = await runtimeImport(url);
  if (typeof mod !== 'object' || mod === null) {
    throw new Error(`插件入口模块无效: ${url}`);
  }
  return mod as PluginModule;
}

export async function fetchManifestJson(manifestUrl: string): Promise<unknown> {
  const res = await fetch(manifestUrl, { credentials: 'omit' });
  if (!res.ok) {
    throw new Error(`获取 plugin.json 失败: HTTP ${res.status} (${manifestUrl})`);
  }
  return await res.json();
}

/**
 * Simple string hash (djb2) used by the dev hot-reload watcher to detect
 * entry-file changes without relying on ETag support from dev servers.
 */
export function hashString(input: string): string {
  let hash = 5381;
  for (let i = 0; i < input.length; i++) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0;
  }
  return hash.toString(36);
}
