/**
 * Normalization of Controller-side audit events (GET /api/v1/audit, upstream
 * #1270) into the dashboard's local AuditEventRecord shape so the audit
 * section can render a single unified table regardless of data source.
 *
 * The Controller store records governance events from ALL entry points
 * (durable MinIO JSONL, see AgentTeams docs/design/audit-events-api.md);
 * the local dashboard log only covers this instance's proxied mutations.
 * Both are surfaced with a `source` badge — never silently merged.
 *
 * Field names verified against audit_handler.go (auditEventResponse):
 * ts / kind / actor / target / targetTeam / action / capability /
 * before / after / detail — all omitempty except ts, kind, actor, action.
 */

import type { AuditEventRecord } from './audit-log';

/** One event as returned by GET /api/v1/audit (upstream #1270). */
export interface ControllerAuditEvent {
  ts: string;
  kind: string;
  actor: string;
  target?: string;
  targetTeam?: string;
  action: string;
  capability?: string;
  before?: string[];
  after?: string[];
  detail?: string;
}

/** Envelope of GET /api/v1/audit. */
export interface ControllerAuditResponse {
  events: ControllerAuditEvent[];
  cursor?: string;
}

/** Local AuditEventRecord plus controller-only enrichment fields. */
export type NormalizedAuditEvent = AuditEventRecord & {
  /** Controller event category (capability | approval_level | channel |
   * source | the exact action name for unknown future kinds). */
  kind?: string;
  /** Team the event was attributed to (targetTeam). */
  team?: string;
};

/**
 * Map a controller event's `kind` onto the local entity-type taxonomy so the
 * existing entity filter keeps working on controller-sourced data. The
 * mapping follows the #1220 §8 event table semantics:
 * - capability / approval_level changes target a HUMAN record
 * - channel credential writes target a WORKER record
 * - external source adds/modifies are system-level
 * - resource-prefixed events retain their resource type (including file writes)
 * - unknown future kinds → system (visible, not filterable to an entity)
 */
export function kindToEntityType(kind: string): AuditEventRecord['entity_type'] {
  const resource = /^(worker|team|manager|human)(?:_|$)/.exec(kind);
  if (resource) return resource[1] as AuditEventRecord['entity_type'];
  switch (kind) {
    case 'capability':
    case 'approval_level':
      return 'human';
    case 'channel':
      return 'worker';
    case 'source':
      return 'system';
    default:
      return 'system';
  }
}

/** Build the detail column text: the controller's controlled summary wins;
 * otherwise derive a compact before/after diff (capability name + value
 * lists — never secret values by upstream construction). */
function buildDetails(ev: ControllerAuditEvent): string {
  if (ev.detail) return ev.detail;
  const parts: string[] = [];
  if (ev.capability) parts.push(ev.capability);
  if (ev.before || ev.after) {
    const before = (ev.before ?? []).join(', ') || '∅';
    const after = (ev.after ?? []).join(', ') || '∅';
    parts.push(`${before} → ${after}`);
  }
  if (ev.targetTeam) parts.push(`team: ${ev.targetTeam}`);
  return parts.join(' | ') || '—';
}

/** Normalize one controller event (index = position within the page, used
 * to build a stable client-side id — the API is keyset-paged and has no
 * per-event id). */
export function normalizeControllerEvent(ev: ControllerAuditEvent, index: number): NormalizedAuditEvent {
  const timestamp = Date.parse(ev.ts);
  return {
    id: `ctrl-${index}-${Number.isFinite(timestamp) ? timestamp : 0}`,
    actor: ev.actor,
    entity_type: kindToEntityType(ev.kind),
    entity_name: ev.target || ev.targetTeam || '—',
    action: ev.action,
    details: buildDetails(ev),
    severity: 'info',
    timestamp: Number.isFinite(timestamp) ? timestamp : Date.now(),
    kind: ev.kind,
    team: ev.targetTeam,
  };
}

/** Normalize a full page. Non-array / malformed entries are skipped, never
 * fatal — the caller treats an unparseable page as a fallback trigger. */
export function normalizeControllerEvents(page: unknown): NormalizedAuditEvent[] | null {
  if (!page || typeof page !== 'object') return null;
  const events = (page as { events?: unknown }).events;
  if (!Array.isArray(events)) return null;
  return events
    .filter((ev): ev is ControllerAuditEvent =>
      !!ev && typeof ev === 'object' && typeof (ev as ControllerAuditEvent).ts === 'string' &&
      typeof (ev as ControllerAuditEvent).action === 'string',
    )
    .map((ev, i) => normalizeControllerEvent(ev, i));
}
