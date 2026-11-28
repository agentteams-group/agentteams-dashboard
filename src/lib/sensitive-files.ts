// 敏感文件过滤（共享定义：server 路由 + client 文件面板）。
// 对齐 workbench 插件 _kb_is_sensitive（agentteams_connector/router.py）：
// 原先 worker-files-panel / room-files-panel 各持一份重复拷贝，
// 知识库 v2（docker-proxy 数据面）server 侧过滤需要同一定义 → 提为共享 lib。
export const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /^\.hermes\/config\.yaml$/,
  /^\.(?:qwenpaw|copaw)\.secret(?:\/|$)/,
  /^\.ssh\//,
  // 插件 _kb_is_sensitive 双规则：credentials 目录本身 + 其下内容
  /^credentials$/,
  /^credentials\//,
  // B1（维护者 1.2.4 联调验收报告）：credentials.yaml 是独立凭证文件，
  // 不在 credentials/ 目录下——插件 _kb_is_sensitive 同样漏护，
  // 文件管理视图（比 KB 视图更宽的暴露面）必须覆盖；插件侧已同步补规则。
  /^credentials\.ya?ml$/,
  /^(?:worker|service-account)\.token$/,
  /^openclaw\.json$/,
  /\.lock$/,
];

/** SEC-01/05：通用存储不得绕过专用秘密接口。规则按任意 bucket/key 后缀匹配。 */
export const SENSITIVE_OBJECT_RULES: readonly RegExp[] = [
  // Nacos 管理员口令的旧明文落点；加密迁移前必须同时封堵读、签 URL 与删。
  /(?:^|\/)skills\/config\/nacos\.json$/,
  // 未来秘密前缀统一注册，避免各路由维护不同黑名单。
  /(?:^|\/)\.ssh(?:\/|$)/,
  /(?:^|\/)credentials(?:\/|$)/,
  /(?:^|\/)\.(?:qwenpaw|copaw)\.secret(?:\/|$)/,
  /(?:^|\/)secrets(?:\/|$)/,
  /(?:^|\/)\.secrets(?:\/|$)/,
];

const MAX_DECODE_PASSES = 8;
const UNICODE_SEPARATORS = /[\\/\u2044\u2215\uFF0F\uFF3C]/;

export class StoragePathNormalizationError extends Error {
  constructor(message = 'Invalid storage path encoding') {
    super(message);
    this.name = 'StoragePathNormalizationError';
  }
}

/** 反复解码到稳定值，覆盖 URLSearchParams 已解码一次后的双重/多重编码。 */
export function decodeStoragePath(value: string): string {
  let decoded = String(value);
  for (let pass = 0; pass < MAX_DECODE_PASSES; pass += 1) {
    let next: string;
    try {
      next = decodeURIComponent(decoded);
    } catch {
      throw new StoragePathNormalizationError();
    }
    if (next === decoded) return decoded;
    decoded = next;
  }
  throw new StoragePathNormalizationError('Storage path has too many encoding layers');
}

/**
 * MinIO 调用与敏感判定共用的 canonical path。
 * NFKC 统一全角字符，统一 Unicode/Windows 分隔符，折叠重复分隔符并消解 . / ..。
 * 仅规范化路径，不改变大小写（MinIO object key 大小写敏感）。
 */
export function normalizeStoragePath(value: string): string {
  let decoded: string;
  try {
    decoded = decodeStoragePath(value).normalize('NFKC');
  } catch {
    throw new StoragePathNormalizationError();
  }
  if (decoded.includes('\0') || /[\u0001-\u001f\u007f]/.test(decoded)) {
    throw new StoragePathNormalizationError('Storage path contains control characters');
  }
  const parts = decoded.split(UNICODE_SEPARATORS);
  const out: string[] = [];
  for (const part of parts) {
    if (!part || part === '.') continue;
    if (part === '..') {
      // 根路径之后的 .. 收敛为根；秘密匹配与调用方根约束均消费同一结果。
      if (out.length > 0) out.pop();
      continue;
    }
    out.push(part);
  }
  return out.join('/');
}

export function normalizeStorageBucket(bucket: string): string {
  return normalizeStoragePath(bucket);
}

export function normalizeStorageKey(key: string): string {
  return normalizeStoragePath(key);
}

/**
 * @param name  文件名（basename）
 * @param rel   相对工作区的路径（如 memory/2026-09-15.md）
 * 任一命中即敏感（插件同款双参语义：顶层文件 name=rel，子目录文件按 rel 判前缀）。
 */
export function isSensitiveFileName(name: string, rel: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(rel) || p.test(name));
}

/**
 * 对象存储 bucket 键的敏感判断。先统一解码/Unicode/分隔符，再对每个相对后缀
 * 重试，覆盖 workers/demo/.ssh/id_rsa 等任意前缀。大小写仅用于秘密匹配，
 * 不改变实际 MinIO key。
 */
export function isSensitiveObjectKey(key: string): boolean {
  let canonical: string;
  try {
    canonical = normalizeStorageKey(key);
  } catch {
    return true; // 无法稳定规范化的路径不得进入 MinIO。
  }
  const candidate = canonical.replace(/\/+$/, '');
  if (!candidate) return false;
  const lower = candidate.toLowerCase();
  if (SENSITIVE_OBJECT_RULES.some((rule) => rule.test(lower))) return true;

  const segments = candidate.split('/');
  const base = segments[segments.length - 1] || candidate;
  if (isSensitiveFileName(base, candidate)) return true;
  for (let i = 1; i < segments.length - 1; i++) {
    const suffix = segments.slice(i).join('/');
    if (isSensitiveFileName(segments[i], suffix)) return true;
  }
  return false;
}

/** bucket 与 key 都先规范化；非法编码按秘密路径 fail closed。 */
export function isSensitiveStorageObject(bucket: string, key: string): boolean {
  try {
    normalizeStorageBucket(bucket);
    normalizeStorageKey(key);
  } catch {
    return true;
  }
  return isSensitiveObjectKey(key);
}

/** list prefix 指向秘密对象/秘密目录本身时，必须在访问 MinIO 前返回 404。 */
export function isSensitiveStoragePrefix(bucket: string, prefix: string): boolean {
  return isSensitiveStorageObject(bucket, prefix);
}
