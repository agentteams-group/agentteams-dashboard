/**
 * Human CR spec.modelAccess 的纯逻辑（无 React / window 依赖）。
 *
 * 契约（controller model_access_handler.go + v1beta1 types.go）：
 *   scopes = [{ role?, table?, main?, spawn?, codingCli? }]
 *   - role: '' / '*' / 'team_leader' / 'worker'（空与 * 都表示全部 role）；
 *   - (provider, model) 必须成对；role 为空 = 默认作用域；
 *   - table（共享表引用）与内联 surface 二选一，内联优先（UI 二选一强制）；
 *   - spawn / codingCli 的 inherit = true 表示继承上游（空值合法）；
 *   - 无值 = fail-closed（全锁）。
 * 线形态：codingCli 是数组 [{cli, entries, inherit}]，不是 map。
 */

export interface ModelAccessPair {
  provider: string;
  model: string;
}

export interface ModelAccessSurfaceDraft {
  entries: ModelAccessPair[];
  inherit?: boolean;
}

export interface ModelAccessCliDraft {
  cli: string;
  entries: ModelAccessPair[];
  inherit?: boolean;
}

export interface ModelAccessScopeDraft {
  role: string;
  table: string;
  main: ModelAccessPair[];
  spawn: ModelAccessSurfaceDraft;
  codingCli: ModelAccessCliDraft[];
}

export interface ModelAccessDraft {
  scopes: ModelAccessScopeDraft[];
}

export interface ModelAccessCapability {
  canEdit: boolean;
  inherit?: boolean;
  inheritedFrom?: string;
  reason?: string;
}

export interface ModelAccessCapabilities {
  main?: ModelAccessCapability;
  spawn?: ModelAccessCapability;
  codingCli?: Record<string, ModelAccessCapability | undefined>;
}

export const MODEL_ACCESS_ROLES = [
  { value: '', label: '默认（全部 role）' },
  { value: '*', label: '*（全部 role）' },
  { value: 'team_leader', label: 'team_leader' },
  { value: 'worker', label: 'worker' },
] as const;

function asRecord(x: unknown): Record<string, unknown> | null {
  return x !== null && typeof x === 'object' && !Array.isArray(x)
    ? (x as Record<string, unknown>)
    : null;
}

/** (provider, model) 都是非空字符串。 */
export function isCompletePair(value: unknown): value is ModelAccessPair {
  const record = asRecord(value);
  return (
    !!record &&
    typeof record.provider === 'string' &&
    record.provider.trim() !== '' &&
    typeof record.model === 'string' &&
    record.model.trim() !== ''
  );
}

function readPairs(value: unknown): ModelAccessPair[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      const record = asRecord(entry);
      if (!record) return null;
      return {
        provider: typeof record.provider === 'string' ? record.provider : '',
        model: typeof record.model === 'string' ? record.model : '',
      };
    })
    .filter((entry): entry is ModelAccessPair => entry !== null);
}

function readSurface(value: unknown): ModelAccessSurfaceDraft {
  const record = asRecord(value);
  return {
    entries: readPairs(record?.entries),
    inherit: record?.inherit === true ? true : undefined,
  };
}

function readCodingCli(value: unknown): ModelAccessCliDraft[] {
  const out: ModelAccessCliDraft[] = [];
  if (Array.isArray(value)) {
    for (const item of value) {
      const record = asRecord(item);
      if (!record) continue;
      const cli = typeof record.cli === 'string' ? record.cli : '';
      if (!cli) continue;
      out.push({
        cli,
        entries: readPairs(record.entries),
        inherit: record.inherit === true ? true : undefined,
      });
    }
    return out;
  }
  // 兼容内部 map 形状（读面历史形态）。
  const map = asRecord(value);
  if (map) {
    for (const [cli, item] of Object.entries(map)) {
      const record = asRecord(item);
      out.push({
        cli,
        entries: readPairs(record?.entries),
        inherit: record?.inherit === true ? true : undefined,
      });
    }
  }
  return out;
}

export function emptyScope(): ModelAccessScopeDraft {
  return {
    role: '',
    table: '',
    main: [],
    spawn: { entries: [] },
    codingCli: [],
  };
}

/** 从人 CR（flat 或 {spec:{...}}）读取 modelAccess 草稿。 */
export function draftFromHumanRecord(record: unknown): ModelAccessDraft {
  const root = asRecord(record);
  const holder = asRecord(root?.spec) ?? root;
  const modelAccess = asRecord(holder?.modelAccess);
  const scopes = modelAccess?.scopes;
  if (!Array.isArray(scopes)) return { scopes: [] };
  const out: ModelAccessScopeDraft[] = [];
  for (const item of scopes) {
    const scope = asRecord(item);
    if (!scope) continue;
    out.push({
      role: typeof scope.role === 'string' ? scope.role : '',
      table: typeof scope.table === 'string' ? scope.table : '',
      main: readPairs(scope.main && asRecord(scope.main)?.entries),
      spawn: readSurface(scope.spawn),
      codingCli: readCodingCli(scope.codingCli),
    });
  }
  return { scopes: out };
}

export function capabilitiesFromHumanRecord(
  record: unknown,
): ModelAccessCapabilities | null {
  const root = asRecord(record);
  const holder = asRecord(root?.spec) ?? root;
  const modelAccess = asRecord(holder?.modelAccess);
  const capabilities = asRecord(modelAccess?.capabilities);
  if (!capabilities) return null;
  const isCapability = (value: unknown): value is ModelAccessCapability => {
    const record = asRecord(value);
    return !!record && typeof record.canEdit === 'boolean';
  };
  const out: ModelAccessCapabilities = {};
  if (isCapability(capabilities.main)) out.main = capabilities.main;
  if (isCapability(capabilities.spawn)) out.spawn = capabilities.spawn;
  const cli = asRecord(capabilities.codingCli);
  if (cli) {
    const map: Record<string, ModelAccessCapability> = {};
    for (const [name, value] of Object.entries(cli)) {
      if (isCapability(value)) map[name] = value;
    }
    if (Object.keys(map).length) out.codingCli = map;
  }
  return out.main || out.spawn || out.codingCli ? out : null;
}

export function allSurfacesLocked(
  capabilities: ModelAccessCapabilities | null | undefined,
): boolean {
  if (!capabilities) return false;
  if (capabilities.main?.canEdit !== false) return false;
  if (capabilities.spawn?.canEdit !== false) return false;
  const cli = capabilities.codingCli;
  if (cli && Object.keys(cli).length) {
    return Object.values(cli).every((cap) => !!cap && cap.canEdit === false);
  }
  return true;
}

export interface PairIssue {
  scope: number;
  surface: 'main' | 'spawn' | 'codingCli';
  cli?: string;
  index: number;
}

/** 不完整 (provider, model) 行（行内红字 + 保存门）。 */
export function findPairIssues(draft: ModelAccessDraft): PairIssue[] {
  const issues: PairIssue[] = [];
  draft.scopes.forEach((scope, scopeIndex) => {
    if (scope.table.trim()) return; // 共享表模式：内联内容被忽略
    const check = (
      entries: ModelAccessPair[],
      surface: PairIssue['surface'],
      cli?: string,
    ) => {
      entries.forEach((entry, index) => {
        if (!isCompletePair(entry)) {
          issues.push({ scope: scopeIndex, surface, ...(cli ? { cli } : {}), index });
        }
      });
    };
    check(scope.main, 'main');
    if (!scope.spawn.inherit) check(scope.spawn.entries, 'spawn');
    for (const cli of scope.codingCli) {
      if (!cli.inherit) check(cli.entries, 'codingCli', cli.cli);
    }
  });
  return issues;
}

function cleanPairs(entries: ModelAccessPair[]): ModelAccessPair[] {
  return entries
    .filter(isCompletePair)
    .map((entry) => ({ provider: entry.provider.trim(), model: entry.model.trim() }));
}

/** 一个 scope → wire 载荷；空 scope → null。 */
export function serializeScope(
  scope: ModelAccessScopeDraft,
): Record<string, unknown> | null {
  const out: Record<string, unknown> = {};
  const role = scope.role.trim();
  if (role) out.role = role;
  const table = scope.table.trim();
  if (table) {
    // 共享表与内联授权二选一；表模式只写 table。
    out.table = table;
    return out;
  }

  const mainEntries = cleanPairs(scope.main);
  if (mainEntries.length) out.main = { entries: mainEntries };

  const spawnEntries = cleanPairs(scope.spawn.entries);
  if (scope.spawn.inherit) out.spawn = { inherit: true };
  else if (spawnEntries.length) out.spawn = { entries: spawnEntries };

  const codingCli: Record<string, unknown>[] = [];
  for (const cli of scope.codingCli) {
    const name = cli.cli.trim();
    if (!name) continue;
    const one: Record<string, unknown> = { cli: name };
    if (cli.inherit) one.inherit = true;
    else {
      const entries = cleanPairs(cli.entries);
      if (entries.length) one.entries = entries;
    }
    if (Object.keys(one).length > 1) codingCli.push(one);
  }
  if (codingCli.length) out.codingCli = codingCli;

  return Object.keys(out).length ? out : null;
}

/** 草稿 → wire 载荷；null = 无有效作用域（保存时按空 scopes 清空 = fail-closed）。 */
export function buildModelAccessPayload(
  draft: ModelAccessDraft,
): Record<string, unknown> | null {
  const scopes: Record<string, unknown>[] = [];
  for (const scope of draft.scopes) {
    const wire = serializeScope(scope);
    if (wire) scopes.push(wire);
  }
  return scopes.length ? { scopes } : null;
}
