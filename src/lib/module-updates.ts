// Millforge module-update index (upstream #1526, controller endpoint
// `GET /api/v1/millforge/index`).
//
// The controller re-serves the release `channels.json` with a validated
// envelope: `modules` maps an index module key to its latest version and
// version table. Installed state comes from the per-plane registries
// (`/teams/{name}/modules`, `/workers/{name}/plugins`,
// `/managers/{name}/plugins`), keyed by the plugin registry id — which for a
// bundle module is the index `pluginId`, not the index module key.

import { compareSemver } from './version';

export interface MillforgeArtifact {
  name: string;
  sha256: string;
}

export interface MillforgeVersion {
  artifacts?: MillforgeArtifact[];
  requires?: Record<string, string>;
  commit?: string;
  published_at?: string;
  deprecated?: boolean;
}

export interface MillforgeModuleEntry {
  kind?: string;
  pluginId?: string;
  latest?: string | null;
  versions?: Record<string, MillforgeVersion>;
  note?: string;
}

export interface MillforgeIndex {
  schema: number;
  channel: string;
  modules: Record<string, MillforgeModuleEntry>;
  source: string;
  repo: string;
  fetched_at: string;
}

/** One index row, normalized for the update table. */
export interface IndexModule {
  module: string;
  pluginId: string;
  kind: string;
  latest: string | null;
  note?: string;
}

export type ModuleUpdateState =
  | 'update-available'
  | 'uptodate'
  | 'not-installed'
  | 'unknown';

/** Flatten the index into sorted, displayable rows. */
export function indexModules(index: MillforgeIndex | null | undefined): IndexModule[] {
  if (!index?.modules) return [];
  return Object.entries(index.modules)
    .map(([module, entry]) => ({
      module,
      pluginId: entry.pluginId || module,
      kind: entry.kind || '',
      latest: entry.latest ?? null,
      note: entry.note,
    }))
    .sort((a, b) => a.module.localeCompare(b.module));
}

/**
 * Compare the installed version(s) of a module with the index's latest.
 * A team aggregate can carry several versions; any member behind latest is
 * an update. An empty `latest` (e.g. the reserved `looprunner` module) is
 * "unknown", not "not installed".
 */
export function moduleUpdateState(
  installedVersions: string[] | null | undefined,
  latest: string | null | undefined,
): ModuleUpdateState {
  if (!latest) return 'unknown';
  const versions = (installedVersions ?? []).filter((version) => version.trim().length > 0);
  if (versions.length === 0) return 'not-installed';
  return versions.some((version) => compareSemver(version, latest) < 0)
    ? 'update-available'
    : 'uptodate';
}

/** Current-version label for a row; empty when the module is absent. */
export function installedVersionsLabel(versions: string[] | null | undefined): string {
  const unique = Array.from(new Set((versions ?? []).filter((version) => version.trim().length > 0)));
  return unique.length > 0 ? unique.join(' / ') : '未安装';
}
