// Nested write helpers for runtime surfaces.
//
// Ported from the workbench plugin `lib/surfacePatch.ts`: the controller's
// member-config patch must be a nested object, sensitive leaves are written as
// one whole value, and sensitive objects arrive from the UI as text that has to
// be parsed at save time (never re-writing a masked "***").

import { isSensitiveUnchanged, type SurfaceField } from './runtime-surface';

export function getPath(obj: Record<string, unknown>, key: string): unknown {
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

export function setPath(obj: Record<string, unknown>, key: string, value: unknown): void {
  const parts = key.split('.');
  let cur: Record<string, unknown> = obj;
  for (let i = 0; i < parts.length - 1; i += 1) {
    const p = parts[i];
    const next = cur[p];
    if (!next || typeof next !== 'object' || Array.isArray(next)) cur[p] = {};
    cur = cur[p] as Record<string, unknown>;
  }
  cur[parts[parts.length - 1]] = value;
}

export interface SensitiveParseResult {
  patch: Record<string, unknown>;
  errors: Record<string, string>;
}

/** Parse sensitive-object text (whole-value write). Masked/empty = unchanged. */
export function applySensitiveObjectText(
  surfaceFields: SurfaceField[],
  draft: Record<string, unknown>,
  patch: Record<string, unknown>,
): SensitiveParseResult {
  const errors: Record<string, string> = {};
  for (const field of surfaceFields) {
    if (!(field.sensitive && field.type === 'object')) continue;
    const raw = draft[field.key];
    if (isSensitiveUnchanged(field, raw)) continue;
    if (getPath(patch, field.key) === undefined) continue;
    if (typeof raw !== 'string') continue;
    try {
      setPath(patch, field.key, JSON.parse(raw));
    } catch {
      errors[field.key] = 'JSON 格式不对';
      break;
    }
  }
  return { patch, errors };
}
