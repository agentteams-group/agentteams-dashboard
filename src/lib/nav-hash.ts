/**
 * Layered hash routes for the Workbench IA (PRD §5.3 / 附录 A).
 *
 * Section ids stay flat ('chat', 'tasks', …) — this module is the only place
 * that maps between flat section ids and the layered `#workbench/*` /
 * `#console/*` hash space. Old flat hashes are normalized on first resolve
 * via history.replaceState so legacy bookmarks keep working without adding
 * history entries (PRD §5.4).
 */

export type NavArea = 'workbench' | 'console';

/** A resolved navigation target: flat section id plus optional deep-link. */
export interface ResolvedHash {
  section: string;
  /** Room id for `#workbench/space/<roomId>` deep links. */
  roomId?: string;
  /** Query params (e.g. `project=<id>` on task deep links). */
  params?: URLSearchParams;
}

/** Resource tab ids reachable via `#console/resources/<tab>` deep links. */
export const RESOURCE_TABS = ['workers', 'teams', 'humans', 'managers'] as const;
export type ResourceTabId = (typeof RESOURCE_TABS)[number];

/** section id -> canonical layered hash path (without the leading '#'). */
const SECTION_TO_HASH: Record<string, string> = {
  'my-workbench': 'workbench/me',
  chat: 'workbench/space',
  tasks: 'workbench/tasks',
  artifacts: 'workbench/tasks/artifacts',
  'coding-runs': 'workbench/tasks/coding-runs',
  loops: 'workbench/loop',
  resources: 'console/resources',
  workers: 'console/resources/workers',
  teams: 'console/resources/teams',
  humans: 'console/resources/humans',
  managers: 'console/resources/managers',
  skills: 'console/resources/skills',
  models: 'console/resources/models',
  knowledge: 'console/resources/knowledge',
  audit: 'console/governance/audit',
  overview: 'console/system/overview',
};

/**
 * Legacy flat hashes that must resolve even though the canonical hash is
 * now layered. Keyed by the raw hash fragment (no leading '#'). Plugin
 * routes (`plugin-route:*`) and already-layered hashes are handled
 * separately and never hit this table.
 */
const LEGACY_HASH_TO_SECTION: Record<string, string> = {
  overview: 'overview',
  chat: 'chat',
  tasks: 'tasks',
  artifacts: 'artifacts',
  'coding-runs': 'coding-runs',
  workers: 'workers',
  teams: 'teams',
  humans: 'humans',
  managers: 'managers',
  skills: 'skills',
  models: 'models',
  knowledge: 'knowledge',
  audit: 'audit',
  // The standalone projects section was merged into the task board; the
  // alias predates the Workbench IA and keeps resolving.
  projects: 'tasks',
};

/** Prefixes of layered hashes this module understands. */
const LAYERED_PREFIXES = ['workbench', 'console'] as const;

export function isLayeredHash(hash: string): boolean {
  const top = hash.split('/')[0];
  return (LAYERED_PREFIXES as readonly string[]).includes(top);
}

/** Canonical layered hash for a section id (e.g. `workbench/space`). */
export function hashForSection(sectionId: string): string {
  return SECTION_TO_HASH[sectionId] ?? sectionId;
}

/**
 * Canonical hash for an active section while preserving a valid
 * `#console/resources/<tab>` deep link.
 *
 * `hashForSection('resources')` collapses to `console/resources`, which would
 * silently reset the tab on mount. The third segment is reserved for resource
 * tabs, so keep it when it names a known tab.
 */
export function hashForActiveSection(sectionId: string, currentHash: string): string {
  const canonical = hashForSection(sectionId);
  if (sectionId !== 'resources') return canonical;
  const path = currentHash.replace(/^#/, '').split('?')[0];
  const match = /^console\/resources\/([^/]+)$/.exec(path);
  return match && (RESOURCE_TABS as readonly string[]).includes(match[1])
    ? path
    : canonical;
}

/**
 * Resolve a raw hash fragment (no leading '#') to a navigation target.
 * Accepts layered hashes, legacy flat hashes and plugin route hashes.
 * Returns null for unknown hashes so callers can apply their own fallback.
 */
export function resolveHash(
  hash: string,
  isKnownSection: (_section: string) => boolean
): ResolvedHash | null {
  if (!hash) return null;

  // Plugin routes keep their flat `plugin-route:<pluginId>/<routeId>` form —
  // plugin ids look like hash fragments already and survive the round trip.
  if (hash.startsWith('plugin-route:')) {
    return isKnownSection(hash) ? { section: hash } : null;
  }

  if (isLayeredHash(hash)) {
    return resolveLayeredHash(hash);
  }

  const legacy = LEGACY_HASH_TO_SECTION[hash];
  if (legacy && isKnownSection(legacy)) {
    return { section: legacy };
  }
  return null;
}

function resolveLayeredHash(hash: string): ResolvedHash | null {
  const [path, query] = hash.split('?');
  const segments = path.split('/').filter(Boolean);
  const params = query ? new URLSearchParams(query) : undefined;

  // Workbench: space (chat) / tasks (+ artifacts, coding-runs) / loop
  if (segments[0] === 'workbench') {
    if (segments[1] === 'me') return { section: 'my-workbench' };
    if (segments[1] === 'space') {
      // `workbench/space` or `workbench/space/<roomId>`
      return { section: 'chat', roomId: segments[2], params };
    }
    if (segments[1] === 'tasks') {
      if (segments[2] === 'artifacts') return { section: 'artifacts', params };
      if (segments[2] === 'coding-runs') return { section: 'coding-runs', params };
      return { section: 'tasks', params };
    }
    // P1 循环：正式 section（F5.2-F5.5 作者画布/模板库）。
    if (segments[1] === 'loop') return { section: 'loops', params };
    return null;
  }

  // Console: resources / governance / system
  if (segments[0] === 'console') {
    // 资源收敛（F7.1）：workers/teams/humans/managers 分层路径全部进入
    // Agent 目录容器（tab 由 ResourcesSection 从第三段解析）。
    const consoleMap: Record<string, string> = {
      'resources': 'resources',
      'resources/workers': 'resources',
      'resources/teams': 'resources',
      'resources/humans': 'resources',
      'resources/managers': 'resources',
      'resources/skills': 'skills',
      'resources/models': 'models',
      'resources/knowledge': 'knowledge',
      'governance/audit': 'audit',
      'system/overview': 'overview',
    };
    const sub = segments.slice(1).join('/');
    const section = consoleMap[sub];
    return section ? { section, params } : null;
  }

  return null;
}

/**
 * True when the stored section id predates the layered hash scheme and
 * therefore needs a one-time URL normalization (replaceState).
 */
export function needsHashNormalization(hash: string): boolean {
  if (!hash) return false;
  if (hash.startsWith('plugin-route:')) return false;
  return !isLayeredHash(hash);
}
