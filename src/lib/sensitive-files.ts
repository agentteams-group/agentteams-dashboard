// 敏感文件过滤（共享定义：server 路由 + client 文件面板）。
// 对齐 workbench 插件 _kb_is_sensitive（agentteams_connector/router.py）：
// 原先 worker-files-panel / room-files-panel 各持一份重复拷贝，
// 知识库 v2（docker-proxy 数据面）server 侧过滤需要同一定义 → 提为共享 lib。
export const SENSITIVE_PATTERNS: readonly RegExp[] = [
  /^\.hermes\/config\.yaml$/,
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

/**
 * @param name  文件名（basename）
 * @param rel   相对工作区的路径（如 memory/2026-09-15.md）
 * 任一命中即敏感（插件同款双参语义：顶层文件 name=rel，子目录文件按 rel 判前缀）。
 */
export function isSensitiveFileName(name: string, rel: string): boolean {
  return SENSITIVE_PATTERNS.some((p) => p.test(rel) || p.test(name));
}

/**
 * 对象存储 bucket 键的敏感判断。bucket 键常带任意前缀
 * （如 workers/demo/.ssh/id_rsa），SENSITIVE_PATTERNS 的目录规则按
 * 顶层相对路径设计，直接测全键会漏掉嵌在前缀下的敏感目录——
 * 这里对每个相对后缀路径逐级重测（basename 与全键已由
 * isSensitiveFileName 覆盖）。
 */
export function isSensitiveObjectKey(key: string): boolean {
  const segments = key.split('/');
  const base = segments[segments.length - 1] || key;
  if (isSensitiveFileName(base, key)) return true;
  for (let i = 1; i < segments.length - 1; i++) {
    const suffix = segments.slice(i).join('/');
    if (isSensitiveFileName(segments[i], suffix)) return true;
  }
  return false;
}
