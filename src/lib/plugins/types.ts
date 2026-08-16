import type { ComponentType } from 'react';

/**
 * Dashboard plugin system — public contracts.
 *
 * A plugin ships a `plugin.json` manifest plus an ES module entry. The entry
 * exports `activate(api)` (and optionally `deactivate()`); the Dashboard
 * calls `activate` with a scoped API object through which the plugin
 * contributes UI to well-defined extension points.
 */

export const PLUGIN_API_VERSION = 1;

export const EXTENSION_POINTS = [
  'sidebar-menu',
  'route',
  'dashboard-widget',
  'detail-panel',
  'toolbar',
] as const;

export type ExtensionPointId = (typeof EXTENSION_POINTS)[number];

export const EXTENSION_POINT_LABELS: Record<ExtensionPointId, string> = {
  'sidebar-menu': '侧边栏菜单',
  route: '独立页面',
  'dashboard-widget': '仪表盘组件',
  'detail-panel': '详情面板区块',
  toolbar: '工具栏按钮',
};

// ────────────────────────────────────────────
// Manifest (plugin.json)
// ────────────────────────────────────────────

export interface PluginManifest {
  /** Optional K8s-style envelope fields (compat with AgentTeams plugins). */
  apiVersion?: string;
  kind?: string;
  /** Unique plugin id: lowercase letters, digits, '-' and '_'. */
  id: string;
  /** Display name. */
  name: string;
  /** Semver version of the plugin. */
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  /** Entry points. `dashboard` is the ES module loaded by the Dashboard. */
  entry: {
    dashboard?: string;
    /** Upstream AgentTeams backend entry (ignored by the Dashboard). */
    backend?: string;
  };
  /** Semver range of compatible Dashboard versions, e.g. ">=0.2.0". */
  dashboardVersion?: string;
  /** Upstream-style minimum version field, used when dashboardVersion is absent. */
  min_version?: string;
  /** Extension points the plugin intends to use (informational + enforced). */
  extensionPoints?: ExtensionPointId[];
  /** Declarative permission list (informational in the current release). */
  permissions?: string[];
  /** Other plugin ids this plugin depends on. */
  dependencies?: string[];
}

export type PluginSourceKind = 'bundled' | 'url';

export interface PluginSource {
  kind: PluginSourceKind;
  /** Manifest URL for `url` plugins. */
  manifestUrl?: string;
  /** Import factory for `bundled` plugins (compiled into the Dashboard). */
  load?: () => Promise<PluginModule>;
}

export type PluginStatus =
  | 'installed' // manifest registered, module not activated
  | 'enabled' // activation requested (loading)
  | 'active' // module loaded & activated
  | 'disabled' // user turned it off
  | 'error'; // load/activate failed

export interface PluginRecord {
  manifest: PluginManifest;
  source: PluginSource;
  status: PluginStatus;
  error?: string;
  installedAt: number;
}

export interface PluginModule {
  default?: {
    activate: ActivateFn;
    deactivate?: () => void | Promise<void>;
  };
  activate?: ActivateFn;
  deactivate?: () => void | Promise<void>;
}

export type ActivateFn = (_api: DashboardPluginApi) => void | Promise<void>;

// ────────────────────────────────────────────
// Extension point contributions
// ────────────────────────────────────────────

export type Unregister = () => void;

export type MenuItemTarget =
  | { type: 'plugin-route'; routeId: string }
  | { type: 'section'; sectionId: string }
  | { type: 'href'; url: string };

export interface MenuItemContribution {
  id: string;
  label: string;
  /** Lucide icon name resolved by the host (e.g. 'activity'). */
  icon?: string;
  target: MenuItemTarget;
  order?: number;
}

export interface RouteComponentProps {
  pluginId: string;
}

export interface RouteContribution {
  id: string;
  title: string;
  component: ComponentType<RouteComponentProps>;
}

export type WidgetSize = 'sm' | 'md' | 'lg';

export interface WidgetContribution {
  id: string;
  title: string;
  component: ComponentType;
  size?: WidgetSize;
  order?: number;
}

export type DetailEntityKind = 'worker' | 'team' | 'manager' | 'human';

export interface DetailBlockProps<TEntity = unknown> {
  entity: TEntity;
}

export interface DetailBlockContribution {
  id: string;
  entity: DetailEntityKind;
  component: ComponentType<DetailBlockProps<never>>;
  order?: number;
}

export interface ToolbarButtonContribution {
  id: string;
  label: string;
  icon?: string;
  onClick?: () => void;
  /** Rendered instead of the default icon button when provided. */
  component?: ComponentType;
  order?: number;
}

export type AnyContribution =
  | MenuItemContribution
  | RouteContribution
  | WidgetContribution
  | DetailBlockContribution
  | ToolbarButtonContribution;

// ────────────────────────────────────────────
// Plugin API surface
// ────────────────────────────────────────────

export interface PluginEvents {
  on: (_event: string, _handler: (_payload?: unknown) => void) => Unregister;
  off: (_event: string, _handler: (_payload?: unknown) => void) => void;
  emit: (_event: string, _payload?: unknown) => void;
}

export interface PluginStore<TState extends Record<string, unknown> = Record<string, unknown>> {
  getState: () => TState;
  setState: (_partial: Partial<TState>) => void;
  subscribe: (_listener: () => void) => Unregister;
}

export interface PluginHttp {
  fetch: (_path: string, _init?: RequestInit) => Promise<Response>;
  get: <T = unknown>(_path: string) => Promise<T>;
  post: <T = unknown>(_path: string, _body?: unknown) => Promise<T>;
}

export interface PluginDashboardServices {
  /** Navigate to a built-in section or a plugin route section id. */
  navigate: (_sectionId: string) => void;
  toast: (_message: string, _type?: 'info' | 'success' | 'warning' | 'error') => void;
  getClusterStatus: () => Promise<unknown>;
  getVersion: () => Promise<unknown>;
  listWorkers: () => Promise<unknown>;
  listTeams: () => Promise<unknown>;
  listManagers: () => Promise<unknown>;
  listHumans: () => Promise<unknown>;
  /** List all storage buckets. */
  listBuckets: () => Promise<Array<{ name: string; creationDate?: string }>>;
  /** List objects in a bucket with optional prefix (scan). */
  listObjects: (_bucket: string, _prefix?: string) => Promise<Array<{ key: string; size: number; lastModified?: string; isPrefix?: boolean }>>;
  /** Upload a file to a bucket. */
  uploadObject: (_bucket: string, _key: string, _file: File) => Promise<void>;
  /** Get a download URL for an object. */
  getDownloadUrl: (_bucket: string, _key: string) => string;
  /** Get a presigned download URL (safe for direct browser access). */
  presignDownloadUrl: (_bucket: string, _key: string) => Promise<string>;
  /** Get a presigned upload URL for direct browser upload. */
  presignUploadUrl: (_bucket: string, _key: string, _contentType?: string) => Promise<{ url: string; fields?: Record<string, string> }>;
}

export interface PluginLogger {
  info: (..._args: unknown[]) => void;
  warn: (..._args: unknown[]) => void;
  error: (..._args: unknown[]) => void;
}

export interface DashboardPluginApi {
  pluginId: string;
  dashboardVersion: string;
  pluginApiVersion: number;

  registerMenuItem: (_item: MenuItemContribution) => Unregister;
  registerRoute: (_route: RouteContribution) => Unregister;
  registerWidget: (_widget: WidgetContribution) => Unregister;
  registerDetailBlock: (_block: DetailBlockContribution) => Unregister;
  registerToolbarButton: (_button: ToolbarButtonContribution) => Unregister;
  /** Generic registration dispatched by extension point id. */
  registerComponent: (_point: ExtensionPointId, _contribution: AnyContribution) => Unregister;

  events: PluginEvents;
  store: PluginStore;
  http: PluginHttp;
  dashboard: PluginDashboardServices;
  log: PluginLogger;
}

// ────────────────────────────────────────────
// Section id helpers (plugin routes live in the section router)
// ────────────────────────────────────────────

const PLUGIN_SECTION_PREFIX = 'plugin-route:';

export function pluginSectionId(pluginId: string, routeId: string): string {
  return `${PLUGIN_SECTION_PREFIX}${pluginId}/${routeId}`;
}

export function parsePluginSectionId(
  sectionId: string
): { pluginId: string; routeId: string } | null {
  if (!sectionId.startsWith(PLUGIN_SECTION_PREFIX)) return null;
  const rest = sectionId.slice(PLUGIN_SECTION_PREFIX.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { pluginId: rest.slice(0, slash), routeId: rest.slice(slash + 1) };
}

export function isPluginSectionId(sectionId: string): boolean {
  return sectionId.startsWith(PLUGIN_SECTION_PREFIX);
}
