import type { ExtensionPointId, PluginManifest } from './types';
import { EXTENSION_POINTS } from './types';
import { satisfies } from './semver';

/**
 * plugin.json parsing and validation.
 *
 * The manifest format is intentionally aligned with the upstream AgentTeams
 * plugin manifest (id/name/version/description/author/entry/dependencies) so
 * one plugin package can carry both a backend entry (`entry.backend`,
 * consumed by AgentTeams) and a Dashboard UI entry (`entry.dashboard`,
 * consumed here).
 */

export class PluginManifestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PluginManifestError';
  }
}

const ID_PATTERN = /^[a-z0-9][a-z0-9-_]{0,63}$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ValidateManifestOptions {
  /** Dashboard version used for the compatibility check. */
  dashboardVersion?: string;
  /** Skip the dashboardVersion gate (tests). */
  skipVersionCheck?: boolean;
}

export function validatePluginManifest(
  input: unknown,
  options: ValidateManifestOptions = {}
): PluginManifest {
  if (!isRecord(input)) {
    throw new PluginManifestError('plugin.json 必须是 JSON 对象');
  }

  const id = input.id;
  if (typeof id !== 'string' || !ID_PATTERN.test(id)) {
    throw new PluginManifestError('manifest.id 只能包含小写字母、数字、"-" 和 "_"');
  }

  const name = typeof input.name === 'string' && input.name.trim() ? input.name.trim() : id;
  const version = input.version;
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+/.test(version.trim())) {
    throw new PluginManifestError(`插件 ${id}: manifest.version 必须是语义化版本 (如 1.0.0)`);
  }

  const entry = input.entry;
  if (!isRecord(entry)) {
    throw new PluginManifestError(`插件 ${id}: manifest.entry 缺失`);
  }
  const dashboardEntry = entry.dashboard;
  if (typeof dashboardEntry !== 'string' || dashboardEntry.trim().length === 0) {
    throw new PluginManifestError(
      `插件 ${id}: manifest.entry.dashboard 缺失（Dashboard 插件必须提供 JS 入口）`
    );
  }

  const manifest: PluginManifest = {
    id,
    name,
    version: version.trim(),
    entry: { dashboard: dashboardEntry.trim() },
  };

  if (input.apiVersion === 'agentteams.agentteam/v1alpha1' || typeof input.apiVersion === 'string') {
    manifest.apiVersion = String(input.apiVersion);
  }
  if (typeof input.kind === 'string') manifest.kind = input.kind;
  if (typeof input.description === 'string') manifest.description = input.description;
  if (typeof input.author === 'string') manifest.author = input.author;
  if (typeof input.homepage === 'string') manifest.homepage = input.homepage;
  if (typeof entry.backend === 'string') manifest.entry.backend = entry.backend;

  if (input.extensionPoints !== undefined) {
    if (!Array.isArray(input.extensionPoints)) {
      throw new PluginManifestError(`插件 ${id}: extensionPoints 必须是数组`);
    }
    const points: ExtensionPointId[] = [];
    for (const p of input.extensionPoints) {
      if (!EXTENSION_POINTS.includes(p as ExtensionPointId)) {
        throw new PluginManifestError(
          `插件 ${id}: 未知扩展点 "${String(p)}"，可选值: ${EXTENSION_POINTS.join(', ')}`
        );
      }
      points.push(p as ExtensionPointId);
    }
    manifest.extensionPoints = points;
  }

  if (input.permissions !== undefined) {
    if (!Array.isArray(input.permissions) || input.permissions.some((x) => typeof x !== 'string')) {
      throw new PluginManifestError(`插件 ${id}: permissions 必须是字符串数组`);
    }
    manifest.permissions = input.permissions as string[];
  }

  if (input.dependencies !== undefined) {
    if (!Array.isArray(input.dependencies) || input.dependencies.some((x) => typeof x !== 'string')) {
      throw new PluginManifestError(`插件 ${id}: dependencies 必须是字符串数组`);
    }
    manifest.dependencies = input.dependencies as string[];
  }

  const declaredRange =
    typeof input.dashboardVersion === 'string' && input.dashboardVersion.trim()
      ? input.dashboardVersion.trim()
      : typeof input.min_version === 'string' && input.min_version.trim()
        ? `>=${input.min_version.trim()}`
        : undefined;
  if (typeof input.dashboardVersion === 'string') {
    manifest.dashboardVersion = declaredRange;
  }
  if (typeof input.min_version === 'string') {
    manifest.min_version = input.min_version.trim();
  }

  if (!options.skipVersionCheck && declaredRange && options.dashboardVersion) {
    if (!satisfies(options.dashboardVersion, declaredRange)) {
      throw new PluginManifestError(
        `插件 ${id} 需要 Dashboard 版本 ${declaredRange}，当前为 ${options.dashboardVersion}`
      );
    }
  }

  return manifest;
}

/** Validates a contribution id (used across all register* methods). */
export function validateContributionId(pluginId: string, id: unknown): string {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-_]{0,63}$/i.test(id)) {
    throw new Error(`插件 ${pluginId}: 扩展项 id 非法（允许字母、数字、"-"、"_"）`);
  }
  return id;
}
