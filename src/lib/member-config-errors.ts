// Member-config error classification (pure) — ported from the workbench plugin
// `lib/memberConfigErrors.ts`. Turns a MemberConfigError into a discriminated
// union the panel can switch on instead of parsing prose.
//
// Controller contract (#1493 member_config.go):
//   409 stale_rev{current,expected} / 422 unknown_field{fields}
//   422 no_writable_keys{unsupported} / 422 invalid_value{key,detail}
//   409 runtime_unknown{runtime,supported} / 403 / 404|405 / 502

import { MemberConfigError } from './member-config-api';

export type WriteErrorKind =
  | { kind: 'stale_rev' }
  | { kind: 'unknown_field'; fields: string[] }
  | { kind: 'no_writable_keys'; unsupported: Array<{ key: string; reason: string }> }
  | { kind: 'invalid_value'; key: string; detail: string }
  | { kind: 'runtime_unknown'; supported: string }
  | { kind: 'forbidden' }
  | { kind: 'retryable'; detail: string }
  | { kind: 'gone' }
  | { kind: 'other'; detail: string };

export type LoadErrorKind =
  | { kind: 'gone' }
  | { kind: 'forbidden' }
  | { kind: 'runtime_unknown'; supported: string }
  | { kind: 'other'; detail: string };

function bodyOf(e: unknown): Record<string, unknown> | null {
  if (!(e instanceof MemberConfigError)) return null;
  return e.detail && typeof e.detail === 'object' ? (e.detail as Record<string, unknown>) : null;
}

function textOf(e: unknown): string {
  if (e instanceof MemberConfigError) return typeof e.detail === 'string' && e.detail ? e.detail : e.message;
  if (e instanceof Error && e.message) return e.message;
  return String(e ?? '');
}

function supportedText(body: Record<string, unknown> | null): string {
  if (!body) return '';
  if (Array.isArray(body.supported)) return (body.supported as string[]).join('、');
  if (typeof body.supported === 'string') return body.supported;
  return '';
}

export function classifyWriteError(e: unknown): WriteErrorKind {
  const body = bodyOf(e);
  if (e instanceof MemberConfigError) {
    switch (e.code) {
      case 'stale_rev':
        return { kind: 'stale_rev' };
      case 'unknown_field':
        return {
          kind: 'unknown_field',
          fields: Array.isArray(body?.fields) ? (body?.fields as string[]) : [],
        };
      case 'no_writable_keys':
        return {
          kind: 'no_writable_keys',
          unsupported: Array.isArray(body?.unsupported)
            ? (body?.unsupported as Array<{ key: string; reason: string }>)
            : [],
        };
      case 'invalid_value':
        return {
          kind: 'invalid_value',
          key: typeof body?.key === 'string' ? (body?.key as string) : '',
          detail: typeof body?.detail === 'string' ? (body?.detail as string) : e.message,
        };
      case 'runtime_unknown':
        return { kind: 'runtime_unknown', supported: supportedText(body) };
      default:
        break;
    }
    if (e.status === 403) return { kind: 'forbidden' };
    if (e.status === 404 || e.status === 405) return { kind: 'gone' };
    if (e.status === 501) return { kind: 'gone' };
    if (e.status === 502) return { kind: 'retryable', detail: textOf(e) };
  }
  return { kind: 'other', detail: textOf(e) };
}

export function classifyLoadError(e: unknown): LoadErrorKind {
  if (e instanceof MemberConfigError) {
    if (e.code === 'runtime_unknown') {
      return { kind: 'runtime_unknown', supported: supportedText(bodyOf(e)) };
    }
    // 501 = controller (or its backend) does not implement this plane — same
    // honest "unsupported" degrade as a missing route.
    if (e.status === 404 || e.status === 405 || e.status === 501) return { kind: 'gone' };
    // 403 = account cannot read this config — panel renders read-only.
    if (e.status === 403) return { kind: 'forbidden' };
  }
  return { kind: 'other', detail: textOf(e) };
}
