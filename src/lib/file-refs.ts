/**
 * Chat file references (#87): the composer inserts workspace files as
 * structured references on an outbound Matrix message via the custom content
 * key `com.agentteams.file_refs` (same pattern as the `long_message`
 * fallback). The receiving side normalizes the key into `file_refs` blocks so
 * both sender and recipients render the same reference chips.
 */

export const FILE_REFS_CONTENT_KEY = 'com.agentteams.file_refs';

export interface FileRef {
  /** Display name of the referenced file (basename). */
  name: string;
  /** Object-storage key of the referenced file. */
  key: string;
  /** Size in bytes when known. */
  size?: number;
  workspace?: { kind: 'worker' | 'team'; ownerName: string };
}

/** Envelope carried on the event content. */
export interface FileRefsPayload {
  refs: FileRef[];
}

const MAX_REFS = 20;
const MAX_NAME_LENGTH = 256;

function parseSingleRef(value: unknown): FileRef | null {
  if (!value || typeof value !== 'object') return null;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.key !== 'string' || !candidate.key) return null;
  const name =
    typeof candidate.name === 'string' && candidate.name
      ? candidate.name.slice(0, MAX_NAME_LENGTH)
      : candidate.key.split('/').pop() || candidate.key.slice(0, MAX_NAME_LENGTH);
  const size = typeof candidate.size === 'number' && Number.isFinite(candidate.size) ? candidate.size : undefined;
  const scope = candidate.workspace as Record<string, unknown> | undefined;
  const workspace = scope && (scope.kind === 'worker' || scope.kind === 'team') && typeof scope.ownerName === 'string'
    ? { kind: scope.kind, ownerName: scope.ownerName } as FileRef['workspace'] : undefined;
  return { name, key: candidate.key, size, ...(workspace ? { workspace } : {}) };
}

/**
 * Parse the `com.agentteams.file_refs` event content value. Accepts both the
 * envelope shape `{ refs: [...] }` and a bare array (forward compatibility),
 * drops malformed entries, and caps the count so a hostile event cannot bloat
 * the render.
 */
export function parseFileRefs(value: unknown): FileRef[] {
  let raw: unknown = value;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const envelope = value as Record<string, unknown>;
    raw = Array.isArray(envelope.refs) ? envelope.refs : [];
  }
  if (!Array.isArray(raw)) return [];
  const refs: FileRef[] = [];
  for (const entry of raw) {
    const ref = parseSingleRef(entry);
    if (ref) refs.push(ref);
    if (refs.length >= MAX_REFS) break;
  }
  return refs;
}

/** Matrix runtimes consume body text even when they ignore custom content fields. */
export function withFileReferences(body: string, refs?: FileRef[]): string {
  if (!refs?.length) return body;
  const details = refs.map(ref => {
    const scope = ref.workspace ? `${ref.workspace.kind === 'team' ? '团队' : 'Worker'}工作空间 ${JSON.stringify(ref.workspace.ownerName)}；` : '';
    return `- 文件名：${JSON.stringify(ref.name)}；${scope}文件键：${JSON.stringify(ref.key)}`;
  });
  return `${body}\n\n引用的工作空间文件（请读取这些指定文件，不要重新选择文件）：\n${details.join('\n')}`;
}
