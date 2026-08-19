import { unzipSync } from 'fflate';

/**
 * Skill package parsing and validation for Dashboard-driven skill distribution.
 *
 * A skill package is a ZIP archive whose single top-level skill directory must
 * contain a SKILL.md with `name` and `description` frontmatter. Files are
 * written to the canonical Worker skill prefix
 * `agents/{workerName}/skills/{skillName}/`. The Worker reconciler fans that
 * canonical prefix out to the runtime-specific location (e.g. the
 * `.qwenpaw/workspaces/default/skills/` tree used by QwenPaw) on its own —
 * Dashboard no longer mirrors per-runtime subpaths so the AT controller has a
 * single authoritative copy of every skill it can reconcile against.
 */

/** Maximum accepted skill package size (matches controller package upload cap). */
export const SKILL_PACKAGE_MAX_BYTES = 64 * 1024 * 1024; // 64 MB

export interface SkillPackageFile {
  /** Path relative to the skill root, using forward slashes (e.g. "SKILL.md", "scripts/run.sh"). */
  relativePath: string;
  data: Uint8Array;
}

export interface ParsedSkillPackage {
  /** Skill name from SKILL.md frontmatter (authoritative). */
  skillName: string;
  /** Skill description from SKILL.md frontmatter. */
  description: string;
  files: SkillPackageFile[];
}

/** Error thrown for any user-fixable skill package validation failure. */
export class SkillPackageError extends Error {}

const NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

/**
 * Validates a path segment (worker name or skill name) for safe use inside a
 * storage key. Rejects empty values, path separators, and dot-segments so a
 * crafted name can never escape the intended prefix.
 */
export function isValidNameSegment(segment: string): boolean {
  if (!segment) return false;
  if (segment === '.' || segment === '..') return false;
  if (segment.includes('/') || segment.includes('\\')) return false;
  return NAME_PATTERN.test(segment);
}

/**
 * Normalizes a ZIP entry path to a forward-slash relative path, or returns
 * null when the entry is unsafe (absolute path, drive letter, or dot-segment)
 * and must be rejected to prevent Zip Slip.
 */
function normalizeEntryPath(rawPath: string): string | null {
  if (!rawPath) return null;
  // Reject absolute paths and Windows drive letters up front.
  if (rawPath.startsWith('/') || rawPath.startsWith('\\') || /^[A-Za-z]:[\\/]/.test(rawPath)) {
    return null;
  }
  const normalized = rawPath.replace(/\\/g, '/');
  const segments = normalized.split('/').filter((seg) => seg.length > 0);
  if (segments.length === 0) return null;
  for (const seg of segments) {
    if (seg === '.' || seg === '..') return null;
  }
  return segments.join('/');
}

/**
 * Extracts `name` and `description` scalar fields from SKILL.md frontmatter
 * (the `---`-delimited block at the top of the file). Only the two required
 * scalar fields are read; nested YAML is intentionally not parsed.
 */
export function parseSkillFrontmatter(skillMd: string): { name: string; description: string } {
  const text = skillMd.replace(/^﻿/, '');
  if (!text.startsWith('---')) {
    throw new SkillPackageError('SKILL.md 缺少 frontmatter（文件须以 "---" 开头）。');
  }
  const end = text.indexOf('\n---', 3);
  if (end === -1) {
    throw new SkillPackageError('SKILL.md frontmatter 未闭合（缺少结尾的 "---"）。');
  }
  const block = text.slice(3, end);

  const readField = (field: string): string => {
    const lines = block.split('\n');
    for (const line of lines) {
      const match = line.match(new RegExp(`^\\s*${field}\\s*:\\s*(.*)$`));
      if (match) {
        let value = match[1].trim();
        // Strip surrounding quotes for simple scalars.
        if (
          (value.startsWith('"') && value.endsWith('"') && value.length >= 2) ||
          (value.startsWith("'") && value.endsWith("'") && value.length >= 2)
        ) {
          value = value.slice(1, -1);
        }
        return value.trim();
      }
    }
    return '';
  };

  const name = readField('name');
  const description = readField('description');

  if (!name) {
    throw new SkillPackageError('SKILL.md frontmatter 缺少必填字段 name。');
  }
  if (!description) {
    throw new SkillPackageError('SKILL.md frontmatter 缺少必填字段 description。');
  }
  if (!isValidNameSegment(name)) {
    throw new SkillPackageError(`SKILL.md 中的技能名 "${name}" 不合法（仅允许字母、数字、点、下划线、连字符）。`);
  }
  return { name, description };
}

/**
 * Parses and validates a skill package ZIP.
 *
 * The archive must contain exactly one skill root directory holding a
 * SKILL.md. Returns the skill name (from frontmatter) plus all files with
 * paths relative to that skill root, ready to be written under
 * `agents/{workerName}/skills/{skillName}/`.
 */
export function parseSkillPackage(zipData: Uint8Array): ParsedSkillPackage {
  if (zipData.byteLength === 0) {
    throw new SkillPackageError('上传的技能包为空。');
  }
  if (zipData.byteLength > SKILL_PACKAGE_MAX_BYTES) {
    throw new SkillPackageError('技能包超过 64 MB 大小限制。');
  }

  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipData);
  } catch (err) {
    const message = err instanceof Error ? err.message : 'unknown';
    throw new SkillPackageError(`技能包不是合法的 ZIP 文件：${message}`);
  }

  // Normalize entry paths and drop directory entries; reject unsafe paths.
  const files: { path: string; data: Uint8Array }[] = [];
  for (const [rawPath, data] of Object.entries(entries)) {
    const isDirectory = rawPath.endsWith('/');
    const normalized = normalizeEntryPath(rawPath);
    if (normalized === null) {
      if (isDirectory) continue; // unsafe directory entries carry no files
      throw new SkillPackageError(`技能包包含非法路径 "${rawPath}"（疑似路径穿越）。`);
    }
    if (isDirectory) continue;
    files.push({ path: normalized, data });
  }

  if (files.length === 0) {
    throw new SkillPackageError('技能包为空（ZIP 内没有文件）。');
  }

  // Locate the SKILL.md and determine the skill root directory.
  const skillMdEntry = files.find((f) => f.path === 'SKILL.md' || f.path.endsWith('/SKILL.md'));
  if (!skillMdEntry) {
    throw new SkillPackageError('技能包缺少 SKILL.md 文件。');
  }
  const skillRoot = skillMdEntry.path === 'SKILL.md'
    ? ''
    : skillMdEntry.path.slice(0, skillMdEntry.path.length - 'SKILL.md'.length);

  const skillMdText = new TextDecoder('utf-8').decode(skillMdEntry.data);
  const { name, description } = parseSkillFrontmatter(skillMdText);

  // Collect files under the skill root, re-rooted relative to it.
  const rootFiles: SkillPackageFile[] = [];
  for (const file of files) {
    if (skillRoot === '') {
      rootFiles.push({ relativePath: file.path, data: file.data });
    } else if (file.path.startsWith(skillRoot)) {
      rootFiles.push({ relativePath: file.path.slice(skillRoot.length), data: file.data });
    }
    // Files outside the skill root are ignored (e.g. sibling README at archive top).
  }

  if (rootFiles.length === 0) {
    throw new SkillPackageError('技能包缺少可分发文件。');
  }

  return { skillName: name, description, files: rootFiles };
}

/**
 * Returns the canonical Worker skills subpath. Every runtime now reads from
 * the same `skills/` directory; the Worker reconciler is responsible for
 * fanning that directory out to runtime-specific locations (e.g. Copaw's
 * `.copaw/workspaces/default/skills/`) so the Dashboard can stay runtime
 * agnostic and the AT controller has a single authoritative copy of every
 * skill to reconcile.
 */
export function runtimeSkillsSubpath(_runtime?: string | null): string {
  return 'skills/';
}

/**
 * Build the storage key for a skill file under a worker's canonical skills
 * prefix. Callers must have already validated both names with
 * {@link isValidNameSegment}; this function asserts the invariant and rejects
 * path escape defensively.
 *
 * `runtime` is accepted for backwards compatibility but is no longer used to
 * derive the storage prefix — all runtimes share the canonical
 * `agents/{workerName}/skills/{skillName}/` directory and rely on the Worker
 * reconciler to materialise runtime-specific mirrors.
 */
export function skillObjectKey(
  workerName: string,
  skillName: string,
  relativePath: string,
  _runtime?: string | null,
): string {
  if (!isValidNameSegment(workerName) || !isValidNameSegment(skillName)) {
    throw new SkillPackageError('Worker 名或技能名不合法。');
  }
  const cleanRelative = normalizeEntryPath(relativePath);
  if (cleanRelative === null) {
    throw new SkillPackageError(`技能文件路径不合法：${relativePath}`);
  }
  return `agents/${workerName}/skills/${skillName}/${cleanRelative}`;
}

/** Returns the canonical worker skills prefix. Runtime is no longer part of
 * the path (see {@link runtimeSkillsSubpath}). */
export function workerSkillsPrefix(workerName: string, _runtime?: string | null): string {
  if (!isValidNameSegment(workerName)) {
    throw new SkillPackageError('Worker 名不合法。');
  }
  return `agents/${workerName}/skills/`;
}
