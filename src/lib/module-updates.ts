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
 * Semver comparison that keeps prerelease ordering meaningful.
 *
 * `compareSemver` (shared helper) treats every prerelease suffix as equal,
 * which collapses `0.1.1-alpha.1` / `0.1.1-alpha.2` into one version. The
 * release index publishes alpha/beta builds, so the update table must order
 * them: numeric core first, then prerelease segments (numeric-aware, and a
 * release sorts above any prerelease of the same core).
 */
export function compareModuleVersions(a: string, b: string): number {
  const base = compareSemver(a, b);
  if (base !== 0) return base;
  const prerelease = (value: string): string => {
    const match = /^v?\d+(?:\.\d+){0,2}(?:\+[0-9A-Za-z.-]+)?-([0-9A-Za-z.-]+)$/.exec(value.trim());
    return match ? match[1] : '';
  };
  const left = prerelease(a);
  const right = prerelease(b);
  if (left === right) return 0;
  if (!left) return 1;
  if (!right) return -1;
  const leftParts = left.split('.');
  const rightParts = right.split('.');
  const length = Math.max(leftParts.length, rightParts.length);
  for (let i = 0; i < length; i += 1) {
    const l = leftParts[i];
    const r = rightParts[i];
    if (l === undefined) return -1;
    if (r === undefined) return 1;
    const numeric = /^\d+$/.test(l) && /^\d+$/.test(r);
    if (numeric) {
      const diff = Number.parseInt(l, 10) - Number.parseInt(r, 10);
      if (diff !== 0) return diff;
    } else if (l !== r) {
      return l < r ? -1 : 1;
    }
  }
  return 0;
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
  return versions.some((version) => compareModuleVersions(version, latest) < 0)
    ? 'update-available'
    : 'uptodate';
}

/** Current-version label for a row; empty when the module is absent. */
export function installedVersionsLabel(versions: string[] | null | undefined): string {
  const unique = Array.from(new Set((versions ?? []).filter((version) => version.trim().length > 0)));
  return unique.length > 0 ? unique.join(' / ') : '未安装';
}

/** One selectable index version (version dropdown). */
export interface ModuleVersionOption {
  value: string;
  disabled: boolean;
  /** current = already installed；unavailable = 缺可安装的 zip 制品/校验和. */
  reason: 'current' | 'unavailable' | null;
}

/** 版本条目是否有可安装制品（安装 payload 需要 .zip + sha256）。 */
function installableVersion(version: MillforgeVersion | null | undefined): boolean {
  return (version?.artifacts ?? []).some(
    (artifact) => !!artifact?.sha256 && !!artifact?.name?.endsWith('.zip'),
  );
}

/**
 * Version dropdown options for one index module: newest first, the installed
 * version and versions without an installable artifact are disabled.
 */
export function buildModuleVersionOptions(
  entry: Pick<MillforgeModuleEntry, 'versions'> | null | undefined,
  currentVersion: string | null | undefined,
): ModuleVersionOption[] {
  const versions = entry?.versions ?? {};
  return Object.entries(versions)
    .filter(([version]) => version.trim().length > 0)
    .sort(([a], [b]) => compareModuleVersions(b, a))
    .map(([version, meta]) => {
      const isCurrent = !!currentVersion && compareModuleVersions(version, currentVersion) === 0;
      const available = installableVersion(meta);
      return {
        value: version,
        disabled: isCurrent || !available,
        reason: isCurrent ? ('current' as const) : available ? null : ('unavailable' as const),
      };
    });
}

/** Default pick = newest installable, non-current option (list already desc). */
export function pickDefaultModuleVersion(options: ModuleVersionOption[]): string | null {
  return options.find((option) => !option.disabled)?.value ?? null;
}

/** Install direction: no current → install; lower than current → downgrade. */
export function moduleInstallDirection(
  version: string,
  currentVersion: string | null | undefined,
): 'install' | 'update' | 'downgrade' {
  if (!currentVersion) return 'install';
  return compareModuleVersions(version, currentVersion) < 0 ? 'downgrade' : 'update';
}
