// Runtime surface (member-config) contract + form helpers.
//
// Ported 1:1 from the workbench plugin (`lib/surfaceForm.ts` /
// `api/domains/memberConfig.ts`) so the dashboard edits the same documents
// with the same optimistic-lock and sensitive-field rules:
//
//   GET  /api/runtimes/{runtime}/surface            field declarations
//   GET  /api/members/{name}/config                 values + rev + reconcile
//   PUT  /api/members/{name}/config?if-rev=...      nested patch, only changes
//   POST /api/members/{name}/config/rollback?rev=.. restore a snapshot
//
// Keys are dotted paths into the nested config document. `buildDraft` flattens
// them into a draft map; `diffNested` folds only changed leaves back into the
// nested patch the controller expects. Sensitive values come back masked as
// "***" and are stored as an `undefined` sentinel so they can never be written
// back unchanged.

export type SurfaceFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'secret'
  | 'array'
  | 'record'
  | 'object'
  | 'int'
  | 'float'
  | 'bool'
  | 'string-list'
  | 'enum';

export interface SurfaceField {
  key: string;
  label?: string;
  type: SurfaceFieldType;
  default?: unknown;
  unit?: string;
  applies: 'hot' | 'next-turn' | 'restart';
  class?: 'selection' | 'definition' | 'policy';
  sensitive?: boolean;
  group?: string;
  enum?: string[];
  /** Optional extras some surfaces carry beyond the #1493 baseline. */
  description?: string;
  tab?: string;
  section?: string;
  advanced?: boolean;
}

export interface SurfaceFace {
  id: string;
  label?: string;
  fields: SurfaceField[];
}

export interface RuntimeSurface {
  runtime: string;
  runtimeVersion?: string;
  surfaceVersion?: string;
  faces: SurfaceFace[];
}

export interface ConfigState {
  runtime: string;
  /** Disk sha256 hex — optimistic lock token for the next write. */
  rev: string;
  /** Nested document; sensitive leaves are masked as "***". */
  values: Record<string, unknown>;
  applied: 'applied' | 'pending' | (string & {});
  pendingRestart: string[];
  inactive?: string[];
}

export interface ConfigWriteResult {
  runtime: string;
  rev: string;
  applied: 'applied' | 'pending' | (string & {});
  pendingRestart: string[];
  inactive?: string[];
  unsupported?: Array<{ key: string; reason: string }>;
  snapshot: unknown;
}

/** Dotted key → nested value (missing segment / non-object mid-path → undefined). */
export function resolvePath(obj: Record<string, unknown>, key: string): unknown {
  let cur: unknown = obj;
  for (const part of key.split('.')) {
    if (cur && typeof cur === 'object' && !Array.isArray(cur)) {
      cur = (cur as Record<string, unknown>)[part];
    } else {
      return undefined;
    }
  }
  return cur;
}

function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a as object);
  const kb = Object.keys(b as object);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k])) return false;
  }
  return true;
}

function setNested(target: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let cur = target;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    const next = cur[p];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

function countStarSegments(key: string): number {
  let n = 0;
  for (const p of key.split('.')) if (p === '*') n += 1;
  return n;
}

/** Two-star templates are read-only in v1 (e.g. models.providers.*.models.*.id). */
export function isReadOnlyField(field: SurfaceField): boolean {
  return countStarSegments(field.key) >= 2;
}

/** Single-star template → entry names present in `values` (object values only). */
export function expandEntries(template: string, values: Record<string, unknown>): string[] {
  const parts = template.split('.');
  const starIdx = parts.indexOf('*');
  if (starIdx === -1 || countStarSegments(template) !== 1) return [];
  let cur: unknown = values ?? {};
  for (let i = 0; i < starIdx; i += 1) {
    if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return [];
    cur = (cur as Record<string, unknown>)[parts[i]];
  }
  if (!cur || typeof cur !== 'object' || Array.isArray(cur)) return [];
  const entries: string[] = [];
  for (const k of Object.keys(cur as Record<string, unknown>)) {
    const v = (cur as Record<string, unknown>)[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && !entries.includes(k)) entries.push(k);
  }
  return entries;
}

export function concreteKey(template: string, entry: string): string {
  const parts = template.split('.');
  const starIdx = parts.indexOf('*');
  if (starIdx === -1) return template;
  parts[starIdx] = entry;
  return parts.join('.');
}

/** Surface declaration → editable draft (dots → values; defaults fill gaps).
 * Sensitive fields read back as "***" become `undefined` (never written). */
export function buildDraft(
  surface: RuntimeSurface,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const draft: Record<string, unknown> = {};
  const v = values ?? {};
  for (const face of surface.faces ?? []) {
    for (const field of face.fields ?? []) {
      if (isReadOnlyField(field)) continue;
      const starIdx = field.key.split('.').indexOf('*');
      const keys =
        starIdx === -1
          ? [field.key]
          : expandEntries(field.key, v).map((e) => concreteKey(field.key, e));
      for (const key of keys) {
        const current = resolvePath(v, key);
        const value = current !== undefined ? current : field.default;
        draft[key] = field.sensitive && (value === undefined || value === '***') ? undefined : value;
      }
    }
  }
  return draft;
}

/** Draft → nested patch with changed leaves only; undefined = not sent. */
export function diffNested(
  draft: Record<string, unknown>,
  values: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const v = values ?? {};
  for (const [key, draftValue] of Object.entries(draft)) {
    if (countStarSegments(key) > 0) continue;
    if (draftValue === undefined) continue;
    if (deepEqual(draftValue, resolvePath(v, key))) continue;
    setNested(patch, key, draftValue);
  }
  return patch;
}

/** Sensitive value still masked/empty → treat as unchanged (never write back). */
export function isSensitiveUnchanged(field: SurfaceField, draftValue: unknown): boolean {
  if (!field.sensitive) return false;
  return draftValue === '***' || draftValue === undefined || draftValue === '';
}

export function formatFieldValue(field: SurfaceField, value: unknown): string {
  if (value === undefined || value === null) return '—';
  if (field.type === 'boolean' || field.type === 'bool') return value ? '是' : '否';
  if (field.type === 'secret') return value === '' ? '' : '••••';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Rev history stack: newest first, de-duplicated, capped (default 5). */
export function pushRev(stack: string[], rev: string, cap = 5): string[] {
  if (!rev) return stack;
  return [rev, ...stack.filter((r) => r !== rev)].slice(0, cap);
}

/** Normalize legacy type aliases to the real contract (idempotent). */
export function normalizeSurface(surface: RuntimeSurface): RuntimeSurface {
  const norm = (t: SurfaceFieldType): SurfaceFieldType => {
    switch (t) {
      case 'int':
      case 'float':
        return 'number';
      case 'bool':
        return 'boolean';
      case 'string-list':
        return 'array';
      case 'enum':
        return 'string';
      default:
        return t;
    }
  };
  return {
    ...surface,
    faces: (surface.faces ?? []).map((face) => ({
      ...face,
      fields: (face.fields ?? []).map((f) => ({ ...f, type: norm(f.type) })),
    })),
  };
}

/** All concrete values matching a (single or double) star template. */
export function collectConcreteValues(template: string, values: Record<string, unknown>): unknown[] {
  const parts = template.split('.');
  const out: unknown[] = [];
  const walk = (obj: unknown, i: number): void => {
    if (i === parts.length) {
      out.push(obj);
      return;
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return;
    if (parts[i] === '*') {
      for (const v of Object.values(obj as Record<string, unknown>)) walk(v, i + 1);
    } else {
      walk((obj as Record<string, unknown>)[parts[i]], i + 1);
    }
  };
  walk(values ?? {}, 0);
  return out;
}
