// 「QwenPaw × QwenCode 桥」安装/更新的纯逻辑（无 React / 无 DOM，可单测）。
//
// 口径移植自工作台 QwenCodeBridgeSection + bridgeModuleModel（release-1669，
// 2026-11-08 千锻模块卡设计）：不逐版本渲染按钮 —— 状态标签（未装 / 可更新 /
// 已是最新 / 该频道无更新 / 该频道暂无版本）+ 频道选择（stable/beta/alpha）+
// 版本下拉（当前版本、缺制品版本 disabled）+ 单个安装/更新/降级按钮。
//
// 数据面（dashboard）：
// - 索引：GET /millforge/index?source=github&repo=LUOSENGWA/Millforge&ref=main&channel=<选择>
// - 已装：GET /workers/{name}/plugins 里 plugin id qwen-code-bridge 的版本
// - 安装：POST /workers/{name}/plugins/install（body.module = 模块键，
//   channel = 当前频道）
//
// 模块键 ≠ pluginId：安装 body 用模块键 qwenpaw-qwencode-bridge，已装对账用
// plugin id qwen-code-bridge（见 方案与设计/Millforge/模块更新-前端接口-20261108.md §0）。

import type { MillforgeIndex, ModuleInstallRequest, PluginMetadataEntry } from './agentteams-api';

/** 索引模块键（安装 body 的 module 字段）。 */
export const BRIDGE_MODULE_KEY = 'qwenpaw-qwencode-bridge';
/** 安装后的 QwenPaw 插件 id（已装列表对账用）。 */
export const BRIDGE_PLUGIN_ID = 'qwen-code-bridge';

/** 本栏固定查询参数（源/仓库/ref 固定；频道由用户选择）。 */
export const BRIDGE_SOURCE = 'github' as const;
export const BRIDGE_REPO = 'LUOSENGWA/Millforge';
export const BRIDGE_REF = 'main';

export const BRIDGE_CHANNELS = ['stable', 'beta', 'alpha'] as const;
export type BridgeChannel = (typeof BRIDGE_CHANNELS)[number];
export const BRIDGE_DEFAULT_CHANNEL: BridgeChannel = 'stable';

/** 规范化后的版本条目（artifact/sha256 已从制品清单补齐）。 */
export interface BridgeVersion {
  version: string;
  /** zip 制品文件名（安装 payload 必填）。 */
  artifact: string;
  /** 制品 sha256（安装 payload 必填；不一致 → 409）。 */
  sha256: string;
  deprecated: boolean;
}

/** 规范化后的桥模块条目。 */
export interface BridgeModule {
  /** 索引条目的 latest（null = 该频道暂无版本）。 */
  latest: string | null;
  versions: BridgeVersion[];
}

/** 桥栏安装状态（ahead = 已装版本高于索引最新，如预装/索引滞后）。 */
export type BridgeState =
  | 'not-installed'
  | 'update-available'
  | 'up-to-date'
  | 'ahead'
  | 'no-versions';

/** 版本下拉选项（禁用原因给标记，UI 侧拼文案）。 */
export interface BridgeOption {
  version: string;
  /** 已装版本（标「当前」并 disabled）。 */
  current: boolean;
  /** 缺 artifact/sha256 等不可安装项（标「不可用」并 disabled）。 */
  disabled: boolean;
  /** 默认选中项（最新可安装且非当前）。 */
  defaultSelected: boolean;
}

/** 选中版本相对已装版本的方向（决定按钮文案）。 */
export type BridgeDirection = 'install' | 'update' | 'downgrade' | 'current';

/** QwenCode 桥面只在 QwenPaw 运行时出现（其它 runtime 整段不渲染）。 */
export function showQwenCodeBridge(runtime: string | undefined | null): boolean {
  return runtime === 'qwenpaw';
}

/** 无原型链的普通对象判定（索引形态宽容解析的入口条件）。 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * semver-lite 版本比较：返回 -1 / 0 / 1（a<b / a==b / a>b）。
 * 预发布后缀（`-alpha.2`）按 semver 口径参与比较：`0.1.1-alpha.2 > 0.1.0`
 * 且 `0.1.1-alpha.2 < 0.1.1`；数字段按数值、其余段按字典序。
 */
export function compareBridgeVersions(a: string, b: string): number {
  const split = (value: string) => {
    const [core, ...rest] = value.trim().replace(/^v/i, '').split('-');
    return {
      core: core.split('.').map((segment) => Number.parseInt(segment, 10) || 0),
      pre: rest.join('-'),
    };
  };
  const pa = split(a);
  const pb = split(b);
  const length = Math.max(pa.core.length, pb.core.length, 3);
  for (let i = 0; i < length; i += 1) {
    const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }
  if (!pa.pre && !pb.pre) return 0;
  if (!pa.pre) return 1;
  if (!pb.pre) return -1;
  const sa = pa.pre.split('.');
  const sb = pb.pre.split('.');
  const preLength = Math.max(sa.length, sb.length);
  for (let i = 0; i < preLength; i += 1) {
    const xa = sa[i];
    const xb = sb[i];
    if (xa === undefined) return -1;
    if (xb === undefined) return 1;
    const na = Number(xa);
    const nb = Number(xb);
    if (Number.isFinite(na) && Number.isFinite(nb)) {
      if (na !== nb) return na < nb ? -1 : 1;
      continue;
    }
    if (xa !== xb) return xa < xb ? -1 : 1;
  }
  return 0;
}

/** 制品清单里挑 zip（缺省第一个）——安装只认 zip。 */
function pickArtifact(raw: Record<string, unknown>, pinned: string): { name: string; sha256: string } | null {
  const artifacts = Array.isArray(raw.artifacts)
    ? raw.artifacts.filter(
        (item): item is { name: string; sha256: string } =>
          isPlainObject(item) &&
          typeof item.name === 'string' &&
          item.name.length > 0 &&
          typeof item.sha256 === 'string' &&
          item.sha256.length > 0,
      )
    : [];
  if (artifacts.length === 0) return null;
  const exact = pinned ? artifacts.find((item) => item.name === pinned) : undefined;
  return exact ?? artifacts.find((item) => item.name.endsWith('.zip')) ?? artifacts[0];
}

/** 单版本条目规范化（补 artifact/sha256；兼容 artifacts 数组形态）。 */
function normalizeVersion(version: string, raw: Record<string, unknown>): BridgeVersion {
  let artifact = typeof raw.artifact === 'string' ? raw.artifact : '';
  let sha256 = typeof raw.sha256 === 'string' ? raw.sha256 : '';
  if (!artifact || !sha256) {
    const picked = pickArtifact(raw, artifact);
    if (picked) {
      artifact = artifact || picked.name;
      sha256 = sha256 || picked.sha256;
    }
  }
  return { version, artifact, sha256, deprecated: raw.deprecated === true };
}

/** 版本列表宽容解析：对象 map（上游形态，key=版本号）/ 数组 / 条目自身单版本。 */
function normalizeVersions(entry: Record<string, unknown>): BridgeVersion[] {
  const raw = entry.versions;
  if (Array.isArray(raw)) {
    return raw
      .filter(
        (item): item is Record<string, unknown> =>
          isPlainObject(item) && typeof item.version === 'string' && item.version.length > 0,
      )
      .map((item) => normalizeVersion(item.version as string, item));
  }
  if (isPlainObject(raw)) {
    return Object.entries(raw)
      .filter(([, value]) => isPlainObject(value))
      .map(([version, value]) => normalizeVersion(version, value as Record<string, unknown>));
  }
  if (typeof entry.version === 'string' && entry.version.length > 0) {
    return [normalizeVersion(entry.version, entry)];
  }
  return [];
}

/**
 * 索引里找桥模块并规范化（模块键优先；兼容按 pluginId 命名/标注的条目）。
 * 入参用 unknown：索引形态（versions 对象 map / 数组）由本函数宽容解析。
 */
export function bridgeModuleFromIndex(index: MillforgeIndex | unknown): BridgeModule | null {
  if (!isPlainObject(index)) return null;
  const modules = index.modules;
  if (!isPlainObject(modules)) return null;
  const direct = modules[BRIDGE_MODULE_KEY];
  const byPlugin = Object.entries(modules).find(
    ([, entry]) => isPlainObject(entry) && entry.pluginId === BRIDGE_PLUGIN_ID,
  )?.[1];
  const byKey = modules[BRIDGE_PLUGIN_ID];
  const entry = direct ?? byPlugin ?? byKey;
  if (!isPlainObject(entry)) return null;
  return {
    latest: typeof entry.latest === 'string' && entry.latest ? entry.latest : null,
    versions: normalizeVersions(entry),
  };
}

/** 可安装 = 制品与校验字段齐全（缺一即索引不完整/400）。 */
export function bridgeInstallable(version: BridgeVersion): boolean {
  return Boolean(version.artifact) && Boolean(version.sha256);
}

/** 版本列表：去弃用 → 新版本在前。 */
export function bridgeVersions(module: BridgeModule | null | undefined): BridgeVersion[] {
  return (module?.versions ?? [])
    .filter((version) => !version.deprecated)
    .sort((a, b) => compareBridgeVersions(b.version, a.version));
}

/** 最新可安装版本号（无 = null）。 */
export function bridgeLatest(versions: BridgeVersion[]): string | null {
  return versions.find(bridgeInstallable)?.version ?? null;
}

/**
 * 状态判定：
 * - 索引 latest 为 null / 无可安装版本 → no-versions（该频道暂无版本）；
 * - 未装 → not-installed；最新 > 已装 → update-available；
 * - 最新 == 已装 → up-to-date；最新 < 已装 → ahead（该频道无更新）。
 */
export function bridgeState({
  installedVersion,
  versions,
  latest,
}: {
  installedVersion?: string | null;
  versions: BridgeVersion[];
  latest?: string | null;
}): BridgeState {
  // latest 显式 null = 该通道暂无版本；undefined（缺字段）交给版本表判定。
  const top = bridgeLatest(versions);
  if (latest === null || !top) return 'no-versions';
  const installed = (installedVersion ?? '').trim();
  if (!installed) return 'not-installed';
  const cmp = compareBridgeVersions(top, installed);
  if (cmp > 0) return 'update-available';
  if (cmp === 0) return 'up-to-date';
  return 'ahead';
}

/**
 * 版本下拉选项：新版本在前；已装版本标「当前」并 disabled；缺制品/sha256
 * 标「不可用」并 disabled；首个可安装且非当前者 = 默认选中。
 * 低于已装的版本仍列出（允许显式降级，设计文档 §1.3）。
 */
export function bridgeOptions(
  versions: BridgeVersion[],
  installedVersion?: string | null,
): BridgeOption[] {
  const installed = (installedVersion ?? '').trim();
  const options: BridgeOption[] = versions.map((version) => {
    const current = Boolean(installed) && compareBridgeVersions(version.version, installed) === 0;
    return {
      version: version.version,
      current,
      disabled: current || !bridgeInstallable(version),
      defaultSelected: false,
    };
  });
  const preferred = options.find((option) => !option.disabled);
  if (preferred) preferred.defaultSelected = true;
  return options;
}

/** 选中版本相对已装版本的方向（决定按钮文案）。 */
export function bridgeDirection(
  version: string,
  installedVersion?: string | null,
): BridgeDirection {
  const installed = (installedVersion ?? '').trim();
  if (!installed) return 'install';
  const cmp = compareBridgeVersions(version, installed);
  if (cmp > 0) return 'update';
  if (cmp < 0) return 'downgrade';
  return 'current';
}

/** 该状态是否需要安装动作（up-to-date / ahead / no-versions 不出按钮）。 */
export function bridgeHasAction(state: BridgeState): boolean {
  return state === 'not-installed' || state === 'update-available';
}

/** 已装插件匹配（plugin id 为准；模块键/显示名兜底，容忍老列表形态）。 */
export function matchBridgePlugin(
  plugins: PluginMetadataEntry[] | null | undefined,
): PluginMetadataEntry | null {
  return (
    (plugins ?? []).find(
      (plugin) =>
        plugin?.id === BRIDGE_PLUGIN_ID ||
        plugin?.name === BRIDGE_PLUGIN_ID ||
        plugin?.id === BRIDGE_MODULE_KEY ||
        plugin?.name === BRIDGE_MODULE_KEY,
    ) ?? null
  );
}

/** 已装桥插件版本（无 = null）。 */
export function bridgeInstalledVersion(
  plugins: PluginMetadataEntry[] | null | undefined,
): string | null {
  return matchBridgePlugin(plugins)?.version ?? null;
}

/** 频道显示名（Select label 集中一处，防文案漂移）。 */
export function bridgeChannelLabel(channel: BridgeChannel): string {
  return channel;
}

/** 安装 body（module 用模块键；channel = 当前选择频道）。 */
export function bridgeInstallBody(
  version: BridgeVersion,
  channel: BridgeChannel,
  repo: string = BRIDGE_REPO,
): ModuleInstallRequest {
  return {
    module: BRIDGE_MODULE_KEY,
    source: BRIDGE_SOURCE,
    repo: repo.trim() || BRIDGE_REPO,
    ref: BRIDGE_REF,
    channel,
    version: version.version,
    artifact: version.artifact,
    sha256: version.sha256,
  };
}

/**
 * 安装失败文案（与千锻模块卡同口径）：409 sha 不一致 / 502 离线 / 404 版本
 * 不存在 / 400 不可安装 / 503 运行时形态不支持。
 */
export function bridgeInstallErrorText(status: number, detail?: string): string {
  const base =
    status === 409
      ? '版本校验失败（sha256 不匹配）——索引与制品不一致，请刷新后重试'
      : status === 502
        ? '目标离线或不可达，稍后重试'
        : status === 404
          ? '版本在索引中不存在，请刷新索引'
          : status === 400
            ? '该模块不可安装（runner 类型或非 zip 制品）'
            : status === 503
              ? '当前部署形态不支持安装该模块（需本地 docker 模式）'
              : status === 403
                ? '当前角色无权在该 Worker 安装插件'
                : '安装失败';
  const text = (detail ?? '').trim();
  return text ? `${base}（${text}）` : base;
}
