/**
 * Human CR spec.workspaceAccess 的纯逻辑（无 React / window 依赖）。
 *
 * 契约（controller human_workspace_access.go）：
 *   workspaceAccess = {
 *     grants:       [{ team, paths, mode: 'read' | 'readwrite' }],
 *     restrictions: [{ team, paths, mode: 'none' | 'read' }],
 *   }
 * - 默认访问按成员关系派生（accessibleTeams ∪ humanMembers），grant 只加授，
 *   restriction 收窄且同路径优先；
 * - 路径必须在 files/ 下；禁止绝对路径、反斜杠、控制字符、尾 /、空段、
 *   . / .. 段、顶层保留名 .trash/.sync/.control；glob 只有 * 与 **；
 * - 同一列表内团队不重复；每列表 ≤32 条规则、每规则 1..16 条路径。
 */

export type AccessMode = 'read' | 'readwrite' | 'none';

export interface WorkspaceAccessRule {
  team: string;
  paths: string[];
  mode: AccessMode;
}

export interface WorkspaceAccess {
  grants?: WorkspaceAccessRule[];
  restrictions?: WorkspaceAccessRule[];
}

const GRANT_MODES: AccessMode[] = ['read', 'readwrite'];
const RESTRICTION_MODES: AccessMode[] = ['none', 'read'];
const RESERVED_TOP_LEVEL = ['.trash', '.sync', '.control'];
export const MAX_RULES_PER_LIST = 32;
export const MAX_PATHS_PER_RULE = 16;

function asRecord(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : null;
}

/** 单条路径校验；null = 合法，否则返回结构化原因码。 */
export function validateAccessPath(path: unknown): string | null {
  if (typeof path !== 'string' || path === '') return 'empty';
  if (path.startsWith('/')) return 'absolute';
  if (path.includes('\\')) return 'backslash';
  for (const ch of path) {
    const code = ch.charCodeAt(0);
    if (code < 32 || code === 127) return 'control';
  }
  if (!path.startsWith('files/')) return 'not_files';
  if (path.endsWith('/')) return 'trailing_slash';
  const rel = path.slice('files/'.length);
  for (const segment of rel.split('/')) {
    if (segment === '') return 'empty_segment';
    if (segment === '.' || segment === '..') return 'dot_segment';
  }
  for (const reserved of RESERVED_TOP_LEVEL) {
    if (rel === reserved || rel.startsWith(reserved + '/')) return 'reserved';
  }
  return null;
}

export interface AccessIssue {
  list: 'grants' | 'restrictions';
  /** 规则下标；-1 = 列表级问题。 */
  index: number;
  kind:
    | 'bad_path'
    | 'bad_mode'
    | 'empty_team'
    | 'dup_team'
    | 'unknown_team'
    | 'no_paths'
    | 'too_many_paths'
    | 'too_many_rules';
  detail?: string;
}

function asRule(value: unknown): WorkspaceAccessRule | null {
  const record = asRecord(value);
  if (!record || typeof record.team !== 'string') return null;
  if (!Array.isArray(record.paths) || typeof record.mode !== 'string') return null;
  return {
    team: record.team,
    paths: record.paths.filter((p): p is string => typeof p === 'string'),
    mode: record.mode as AccessMode,
  };
}

function listRules(
  access: WorkspaceAccess | null | undefined,
  list: 'grants' | 'restrictions',
): WorkspaceAccessRule[] {
  const raw = access?.[list];
  if (!Array.isArray(raw)) return [];
  return raw.map(asRule).filter((r): r is WorkspaceAccessRule => r !== null);
}

/**
 * 纯校验（行内红字与保存门同一来源）：
 * teams = 团队名候选；null/undefined = 端点不可用 → 跳过「团队不存在」检查。
 */
export function validateAccess(
  access: WorkspaceAccess | null | undefined,
  teams?: string[] | null,
): AccessIssue[] {
  const issues: AccessIssue[] = [];
  const checkList = (list: 'grants' | 'restrictions', allowed: AccessMode[]) => {
    const rules = listRules(access, list);
    if (rules.length > MAX_RULES_PER_LIST) {
      issues.push({
        list,
        index: -1,
        kind: 'too_many_rules',
        detail: String(rules.length),
      });
    }
    const seen = new Set<string>();
    rules.forEach((rule, index) => {
      const team = rule.team.trim();
      if (team === '') {
        issues.push({ list, index, kind: 'empty_team' });
      } else {
        if (seen.has(team)) issues.push({ list, index, kind: 'dup_team', detail: team });
        seen.add(team);
        if (teams !== null && teams !== undefined && !teams.includes(team)) {
          issues.push({ list, index, kind: 'unknown_team', detail: team });
        }
      }
      const paths = rule.paths.filter((p) => typeof p === 'string');
      if (paths.length === 0) issues.push({ list, index, kind: 'no_paths' });
      if (paths.length > MAX_PATHS_PER_RULE) {
        issues.push({ list, index, kind: 'too_many_paths', detail: String(paths.length) });
      }
      if (!allowed.includes(rule.mode)) {
        issues.push({ list, index, kind: 'bad_mode', detail: rule.mode });
      }
      for (const path of paths) {
        if (validateAccessPath(path) !== null) {
          issues.push({ list, index, kind: 'bad_path', detail: path });
        }
      }
    });
  };
  checkList('grants', GRANT_MODES);
  checkList('restrictions', RESTRICTION_MODES);
  return issues;
}

/**
 * 编辑器值 → wire 载荷（恒为对象）：
 * - 合法规则保留（team trim 非空 + ≥1 路径 + 模式在列表范围内）；
 * - 两列表都为空 → {}（server 语义：空对象 = 清空两列表）。
 */
export function buildWorkspaceAccessPayload(
  access: WorkspaceAccess | null | undefined,
): Record<string, unknown> {
  const clean = (
    rules: WorkspaceAccessRule[] | undefined,
    allowed: AccessMode[],
  ): Record<string, unknown>[] => {
    const out: Record<string, unknown>[] = [];
    for (const rule of rules ?? []) {
      const team = rule.team.trim();
      const paths = (rule.paths ?? []).filter(
        (p): p is string => typeof p === 'string' && p !== '',
      );
      if (!team || paths.length === 0) continue;
      if (!allowed.includes(rule.mode)) continue;
      out.push({ team, paths, mode: rule.mode });
    }
    return out;
  };
  const out: Record<string, unknown> = {};
  const grants = clean(access?.grants, GRANT_MODES);
  if (grants.length) out.grants = grants;
  const restrictions = clean(access?.restrictions, RESTRICTION_MODES);
  if (restrictions.length) out.restrictions = restrictions;
  return out;
}

/** 从人 CR（flat 或 {spec:{...}} 两形状）读取 workspaceAccess。 */
export function extractWorkspaceAccess(
  record: unknown,
): WorkspaceAccess | null {
  const root = asRecord(record);
  if (!root) return null;
  const holder = asRecord(root.spec) ?? root;
  const raw = asRecord(holder.workspaceAccess);
  if (!raw) return null;
  const out: WorkspaceAccess = {};
  for (const list of ['grants', 'restrictions'] as const) {
    const rules = listRules(raw as WorkspaceAccess, list);
    if (rules.length) out[list] = rules;
  }
  return out;
}

/** 回读比较（team/paths/mode 集合等价，序不敏感）；用于 silent-drop 检测。 */
export function workspaceAccessEqual(
  a: WorkspaceAccess | null,
  b: WorkspaceAccess | null,
): boolean {
  const normalize = (value: WorkspaceAccess | null) => {
    const pick = (list: 'grants' | 'restrictions') =>
      listRules(value, list)
        .map((rule) =>
          JSON.stringify({
            team: rule.team.trim(),
            paths: [...rule.paths].sort(),
            mode: rule.mode,
          }),
        )
        .sort();
    return { grants: pick('grants'), restrictions: pick('restrictions') };
  };
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}
