// Runtime config panel grouping model (pure logic, ported from the workbench
// plugin `lib/configSectionModel.ts`).
//
// Two render modes share this model:
//  - face mode (OpenClaw / Hermes / any surface with faces): one tab per face;
//    capability buckets (mcp / tools / skills / channels / approval) filter
//    faces/fields into the matching resource card.
//  - section mode (surfaces without meaningful face grouping): QwenPaw-style
//    sub-sections (reactAgent / agentLoop / llmRetry / …).
//
// Grouping fallback chain: field.group|tab|section → key prefix bucket →
// top-level alias (mcp/tools/skills/…) → config section.

import type { RuntimeSurface, SurfaceField } from './runtime-surface';

export interface PanelField extends SurfaceField {
  tab?: string;
  section?: string;
  description?: string;
  advanced?: boolean;
}

export type SectionId = 'config' | 'mcp' | 'tools' | 'skills' | 'acp' | 'checkpoints' | 'other';

export interface SubSection {
  id: string;
  label: string;
  fields: PanelField[];
}

export interface Section {
  id: SectionId;
  label: string;
  fields: PanelField[];
  subSections: SubSection[];
}

export const SECTION_ORDER: readonly SectionId[] = [
  'config',
  'mcp',
  'tools',
  'skills',
  'acp',
  'checkpoints',
  'other',
];

const SECTION_LABELS: Record<SectionId, string> = {
  config: '运行配置',
  mcp: 'MCP',
  tools: '工具',
  skills: '技能',
  acp: 'ACP',
  checkpoints: '检查点',
  other: '其他',
};

const TOP_GROUP_ALIASES: Record<string, SectionId> = {
  mcp: 'mcp',
  tool: 'tools',
  tools: 'tools',
  toolsets: 'tools',
  skill: 'skills',
  skills: 'skills',
  acp: 'acp',
  checkpoint: 'checkpoints',
  checkpoints: 'checkpoints',
  other: 'other',
};

export const CONFIG_SUB_ORDER: readonly string[] = [
  'reactAgent',
  'agentLoop',
  'llmRetry',
  'llmRateLimiter',
  'context',
  'memory',
  'embeddingModel',
  'toolExecutionLevel',
];

export function fieldGroup(f: PanelField): string {
  for (const g of [f.group, f.tab, f.section]) {
    if (typeof g === 'string' && g.trim() !== '') return g.trim();
  }
  return '';
}

export function prefixBucket(key: string): string {
  const seg = (key.split('.')[0] ?? '').toLowerCase();
  if (seg.startsWith('llm') || seg.startsWith('model')) return 'llm';
  if (seg.startsWith('memory')) return 'memory';
  if (seg.startsWith('embedding')) return 'embedding';
  if (seg.startsWith('tool') || seg.startsWith('exec')) return 'tools';
  if (seg.startsWith('mcp')) return 'mcp';
  if (seg.startsWith('context') || seg.startsWith('window')) return 'context';
  if (seg.startsWith('retry') || seg.startsWith('timeout')) return 'reliability';
  return 'other';
}

function topLevelForGroup(rawGroup: string): SectionId {
  const g = rawGroup.toLowerCase();
  const first = g.split('.')[0] ?? g;
  return TOP_GROUP_ALIASES[first] ?? 'config';
}

export function buildSections(surface: RuntimeSurface): Section[] {
  const sections: Partial<Record<SectionId, Section>> = {};
  const subKeys = new Map<SectionId, string[]>();
  const subs = new Map<SectionId, Map<string, SubSection>>();

  for (const face of surface.faces ?? []) {
    for (const raw of face.fields ?? []) {
      const f = raw as PanelField;
      const rawGroup = fieldGroup(f) || prefixBucket(f.key);
      const secId = topLevelForGroup(rawGroup);
      let sec = sections[secId];
      if (!sec) {
        sec = { id: secId, label: SECTION_LABELS[secId], fields: [], subSections: [] };
        sections[secId] = sec;
        subKeys.set(secId, []);
        subs.set(secId, new Map());
      }
      sec.fields.push(f);
      const subKey = rawGroup.toLowerCase();
      let sub = subs.get(secId)?.get(subKey);
      if (!sub) {
        sub = { id: rawGroup, label: rawGroup, fields: [] };
        subs.get(secId)?.set(subKey, sub);
        subKeys.get(secId)?.push(subKey);
      }
      sub.fields.push(f);
    }
  }

  const out: Section[] = [];
  for (const id of SECTION_ORDER) {
    const sec = sections[id];
    if (!sec || sec.fields.length === 0) continue;
    let keys = subKeys.get(id) ?? [];
    if (id === 'config') {
      const known = CONFIG_SUB_ORDER.map((c) => c.toLowerCase());
      keys = [...known.filter((k) => keys.includes(k)), ...keys.filter((k) => !known.includes(k))];
    }
    const map = subs.get(id);
    sec.subSections = keys.map((k) => map?.get(k) as SubSection);
    out.push(sec);
  }
  return out;
}

export function filterSection(section: Section, query: string): Section {
  const q = query.trim().toLowerCase();
  const hit = (f: PanelField): boolean => {
    if (q === '') return true;
    return `${f.key} ${f.label ?? ''} ${f.description ?? ''}`.toLowerCase().includes(q);
  };
  const fields = section.fields.filter(hit);
  const subSections = section.subSections
    .map((s) => ({ ...s, fields: s.fields.filter(hit) }))
    .filter((s) => q === '' || s.fields.length > 0);
  return { ...section, fields, subSections };
}

const ADVANCED_TOKENS: readonly string[] = ['retry', 'timeout', 'limit'];

export function advancedFields(section: Section): PanelField[] {
  return section.fields.filter((f) => {
    if (f.advanced === true) return true;
    const key = (f.key ?? '').toLowerCase();
    return ADVANCED_TOKENS.some((tok) => key.includes(tok));
  });
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

/** Changed draft keys vs the load-time baseline (undefined sentinel ignored). */
export function diffDraft(
  draft: Record<string, unknown>,
  initial: Record<string, unknown>,
): string[] {
  const out: string[] = [];
  const init = initial ?? {};
  for (const key of Object.keys(draft ?? {})) {
    const dv = draft[key];
    if (dv === undefined) continue;
    if (deepEqual(dv, init[key])) continue;
    out.push(key);
  }
  return out;
}

export type CapabilityBucket = 'config' | 'mcp' | 'tools' | 'skills' | 'channels' | 'approval';

export function faceBucket(runtime: string, faceId: string): CapabilityBucket {
  const id = (faceId || '').toLowerCase();
  const rt = (runtime || '').toLowerCase();
  if (rt === 'openclaw') {
    if (id === 'mcp') return 'mcp';
    if (id === 'tools') return 'tools';
    if (id === 'skills-plugins') return 'skills';
    if (id === 'channels' || id === 'messaging' || id === 'voice') return 'channels';
    if (id === 'security') return 'approval';
    return 'config';
  }
  if (rt === 'hermes') {
    if (id.startsWith('mcp')) return 'mcp';
    if (
      id === 'toolsets' ||
      id === 'tools' ||
      id === 'terminal' ||
      id === 'tool_output' ||
      id.startsWith('tool_loop')
    )
      return 'tools';
    if (id.startsWith('skill')) return 'skills';
    if (id === 'channels' || id === 'messaging' || id === 'voice' || id === 'discord') return 'channels';
    if (id === 'approvals' || id === 'approval' || id.includes('approval')) return 'approval';
    return 'config';
  }
  return 'config';
}

export interface FaceSubSection {
  id: string;
  label: string;
  fields: PanelField[];
}

export interface FaceSection {
  id: string;
  label: string;
  fields: PanelField[];
  subSections: FaceSubSection[];
}

export function buildFaceSections(surface: RuntimeSurface): FaceSection[] {
  return (surface.faces ?? []).map((face) => {
    const fields = (face.fields ?? []).map((f) => ({ ...f }));
    const order: string[] = [];
    const byGroup = new Map<string, PanelField[]>();
    for (const f of fields) {
      const g = (f.group ?? '').trim();
      if (!byGroup.has(g)) {
        byGroup.set(g, []);
        order.push(g);
      }
      byGroup.get(g)!.push(f);
    }
    const subSections: FaceSubSection[] =
      order.length > 1 || (order.length === 1 && order[0] !== '')
        ? order.map((g) => ({ id: g, label: g, fields: byGroup.get(g) ?? [] }))
        : [];
    return { id: face.id, label: face.label || face.id, fields, subSections };
  });
}

export function fieldBucket(runtime: string, faceId: string, group: string): CapabilityBucket {
  const byFace = faceBucket(runtime, faceId);
  if (byFace !== 'config') return byFace;
  const g = (group || '').trim().toLowerCase();
  if (!g) return 'config';
  for (const seg of g.split(/[._-]+/)) {
    if (seg === 'mcp') return 'mcp';
    if (seg === 'approval' || seg === 'approvals') return 'approval';
    if (
      seg === 'channel' ||
      seg === 'channels' ||
      seg === 'message' ||
      seg === 'messages' ||
      seg === 'messaging' ||
      seg === 'voice'
    )
      return 'channels';
    if (seg === 'skill' || seg === 'skills') return 'skills';
    if (seg === 'tool' || seg === 'tools' || seg === 'toolset' || seg === 'toolsets') return 'tools';
  }
  return 'config';
}

export function filterByBucket(
  runtime: string,
  surface: RuntimeSurface,
  bucket: CapabilityBucket,
): FaceSection[] {
  const out: FaceSection[] = [];
  for (const face of buildFaceSections(surface)) {
    const keep = (f: PanelField): boolean => fieldBucket(runtime, face.id, f.group ?? '') === bucket;
    const fields = face.fields.filter(keep);
    if (fields.length === 0) continue;
    const subSections = face.subSections
      .map((sub) => ({ ...sub, fields: sub.fields.filter(keep) }))
      .filter((sub) => sub.fields.length > 0);
    out.push({ id: face.id, label: face.label, fields, subSections });
  }
  return out;
}
