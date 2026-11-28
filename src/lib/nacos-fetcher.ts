import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import type { Client } from 'minio';
import { getNacosConfig, type NacosConfig } from '@/lib/skill-center-config';
import { SKILLS_BUCKET } from '@/lib/skill-center-types';
import { isValidNameSegment } from '@/lib/skill-package';
import { unzipSync, zipSync } from 'fflate';

export interface NacosZipResult {
  zipBytes: Uint8Array;
  /** The resolved skill name from SKILL.md (may differ from the Nacos registry name). */
  resolvedName: string;
  source: string;
}

export interface NacosFetchDiagnostics {
  mode: string;
  skillsDetailUrl?: string;
  skillsDetailStatus?: number;
  skillsDetailCode?: number;
  servicesListUrl?: string;
  servicesListStatus?: number;
  serviceFound?: boolean;
  hasHomePageUrl?: boolean;
  homePageUrl?: string;
  homePageStatus?: number;
  homePageContentType?: string;
  homePageError?: string;
}

export const NACOS_ARTIFACT_MAX_BYTES = 64 * 1024 * 1024;
export const NACOS_ZIP_MAX_ENTRIES = 4096;
export const NACOS_ZIP_MAX_FILE_BYTES = 16 * 1024 * 1024;
export const NACOS_ZIP_MAX_EXPANDED_BYTES = 128 * 1024 * 1024;
export const NACOS_ZIP_MAX_RATIO = 200;
const MAX_ARTIFACT_REDIRECTS = 3;
const PUBLIC_ARTIFACT_HOSTS = new Set(['github.com', 'codeload.github.com']);

/** Fail closed for loopback, private, link-local, reserved and metadata addresses. */
function isPrivateAddress(address: string): boolean {
  const ip = address.split('%')[0] ?? '';
  if (isIP(ip) === 4) {
    const [a = 0, b = 0, c = 0] = ip.split('.').map(Number);
    return (
      a === 0 || a === 10 || a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 198 && (b === 18 || b === 19 || b === 51)) ||
      (a === 203 && b === 0 && c === 113) ||
      a >= 224
    );
  }
  if (isIP(ip) !== 6) return true;
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (mapped) return isPrivateAddress(mapped[1]);
  const halves = ip.toLowerCase().split('::');
  if (halves.length > 2) return true;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || (halves.length === 2 && missing < 1)) return true;
  const words = [...left, ...Array(missing).fill('0'), ...right].map((part) => Number.parseInt(part, 16));
  if (words.length !== 8 || words.some((word) => !Number.isInteger(word))) return true;
  // Public IPv6 is currently allocated from 2000::/3. This also rejects
  // unspecified, loopback, unique-local, link-local and multicast addresses.
  if ((words[0] & 0xe000) !== 0x2000) return true;
  // Documentation, Teredo and 6to4 can encode non-public destinations.
  if (words[0] === 0x2002) return true;
  if (words[0] === 0x2001 && (words[1] === 0x0db8 || words[1] === 0)) return true;
  return false;
}

const CREDENTIAL_QUERY_KEYS = new Set([
  'accesstoken', 'access_token', 'token', 'authorization', 'password', 'secret',
]);

function encodedVariants(value: string): string[] {
  const forms = new Set<string>([value]);
  let encoded = value;
  for (let i = 0; i < 2; i += 1) {
    encoded = encodeURIComponent(encoded);
    forms.add(encoded);
  }
  forms.add(encodeURI(value));
  forms.add(JSON.stringify(value).slice(1, -1));
  const query = new URLSearchParams({ accessToken: value }).toString();
  forms.add(query.slice(query.indexOf('=') + 1));
  return [...forms].flatMap((form) => [
    form,
    form.replace(/%[0-9a-f]{2}/gi, (part) => part.toLowerCase()),
  ]);
}

/** Redact known secrets and credential-bearing URL fields from diagnostics/errors. */
export function sanitizeNacosText(value: string, secrets: string[] = []): string {
  let safe = value.replace(/\bBearer\s+[^\s,;"']+/gi, 'Bearer [REDACTED]');
  for (const secret of secrets.filter(Boolean)) {
    for (const variant of encodedVariants(secret).sort((a, b) => b.length - a.length)) {
      if (variant) safe = safe.split(variant).join('[REDACTED]');
    }
  }
  try {
    const url = new URL(value);
    for (const key of [...url.searchParams.keys()]) {
      if (CREDENTIAL_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.set(key, '[REDACTED]');
    }
    if (url.username || url.password) {
      url.username = '[REDACTED]';
      url.password = '[REDACTED]';
    }
    safe = safe.split(value).join(url.toString());
  } catch {
    // Not a standalone URL; scrub credential assignments embedded in prose.
  }
  return safe.replace(
    /((?:accessToken|access_token|token|password|secret)\s*[=:]\s*)([^\s&,;"']+)/gi,
    '$1[REDACTED]',
  );
}

export function redactNacosUrl(rawUrl: string, secrets: string[] = []): string {
  try {
    const url = new URL(rawUrl);
    for (const key of [...url.searchParams.keys()]) {
      if (CREDENTIAL_QUERY_KEYS.has(key.toLowerCase())) url.searchParams.set(key, '[REDACTED]');
    }
    url.username = '';
    url.password = '';
    return sanitizeNacosText(url.toString(), secrets);
  } catch {
    return sanitizeNacosText(rawUrl, secrets);
  }
}

interface NacosFetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: string;
  timeoutMs?: number;
  accessToken?: string;
}

/** All Nacos API requests use Bearer auth, reject redirects and sanitize failures. */
export async function nacosFetch(rawUrl: string, options: NacosFetchOptions = {}): Promise<Response> {
  const token = options.accessToken ?? '';
  try {
    return await fetch(rawUrl, {
      method: options.method ?? 'GET',
      headers: {
        ...options.headers,
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: options.body,
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(options.timeoutMs ?? 15000),
    });
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    throw new Error(timedOut ? 'Nacos 请求超时' : 'Nacos 请求失败');
  }
}

export async function readNacosJson<T>(response: Response, accessToken = ''): Promise<T> {
  try {
    return await response.json() as T;
  } catch {
    throw new Error(sanitizeNacosText('Nacos API 返回非法 JSON', [accessToken]));
  }
}

export async function readNacosErrorText(response: Response, accessToken = ''): Promise<string> {
  const text = await response.text().catch(() => '');
  return sanitizeNacosText(text, [accessToken]);
}

function safeArchivePath(rawPath: string): string | null {
  if (!rawPath || rawPath.includes('\0') || rawPath.includes('\\')) return null;
  if (rawPath.startsWith('/') || /^[A-Za-z]:/.test(rawPath)) return null;
  const parts = rawPath.split('/').filter(Boolean);
  if (parts.length === 0 || parts.some((part) => part === '.' || part === '..')) return null;
  return parts.join('/');
}

/** Inspect central-directory metadata before fflate allocates any expanded data. */
function inspectZip(bytes: Uint8Array): void {
  if (bytes.byteLength < 22) throw new Error('技能包不是合法的 ZIP 文件');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  const first = Math.max(0, bytes.byteLength - 65557);
  for (let offset = bytes.byteLength - 22; offset >= first; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) { eocd = offset; break; }
  }
  if (eocd < 0) throw new Error('技能包不是合法的 ZIP 文件');
  const entries = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralOffset = view.getUint32(eocd + 16, true);
  if (entries === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) {
    throw new Error('技能包 ZIP64 格式超出安全限制');
  }
  if (entries > NACOS_ZIP_MAX_ENTRIES) throw new Error('技能包成员数超出安全限制');
  if (centralOffset + centralSize > bytes.byteLength || centralOffset + centralSize > eocd) {
    throw new Error('技能包 ZIP 目录损坏');
  }

  let offset = centralOffset;
  let expanded = 0;
  let compressed = 0;
  const names = new Set<string>();
  for (let index = 0; index < entries; index += 1) {
    if (offset + 46 > bytes.byteLength || view.getUint32(offset, true) !== 0x02014b50) {
      throw new Error('技能包 ZIP 目录损坏');
    }
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const fileCompressed = view.getUint32(offset + 20, true);
    const fileExpanded = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const localOffset = view.getUint32(offset + 42, true);
    const external = view.getUint32(offset + 38, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > bytes.byteLength || localOffset + 30 > bytes.byteLength) throw new Error('技能包 ZIP 目录损坏');
    if (flags & 1) throw new Error('技能包包含加密成员');
    if (method !== 0 && method !== 8) throw new Error('技能包包含不支持的压缩方法');
    if (fileCompressed === 0xffffffff || fileExpanded === 0xffffffff) throw new Error('技能包成员超出安全限制');
    if (fileExpanded > NACOS_ZIP_MAX_FILE_BYTES || fileCompressed > NACOS_ARTIFACT_MAX_BYTES) {
      throw new Error('技能包单文件大小超出安全限制');
    }
    if (fileExpanded > 0 && (fileCompressed === 0 || fileExpanded / fileCompressed > NACOS_ZIP_MAX_RATIO)) {
      throw new Error('技能包压缩比超出安全限制');
    }
    const rawName = new TextDecoder().decode(bytes.subarray(offset + 46, offset + 46 + nameLength));
    const normalized = safeArchivePath(rawName);
    if (!normalized || names.has(normalized)) throw new Error('技能包包含非法或重复成员');
    names.add(normalized);
    const unixType = (external >>> 16) & 0o170000;
    if (unixType && unixType !== 0o100000 && unixType !== 0o040000) {
      throw new Error('技能包包含符号链接或特殊成员');
    }
    if (view.getUint32(localOffset, true) !== 0x04034b50) throw new Error('技能包 ZIP 目录损坏');
    const localExpanded = view.getUint32(localOffset + 22, true);
    if (localExpanded && localExpanded !== fileExpanded) throw new Error('技能包成员大小不一致');
    expanded += fileExpanded;
    compressed += fileCompressed;
    if (expanded > NACOS_ZIP_MAX_EXPANDED_BYTES) throw new Error('技能包解压总大小超出安全限制');
    if (expanded > 0 && (compressed === 0 || expanded / compressed > NACOS_ZIP_MAX_RATIO)) {
      throw new Error('技能包压缩比超出安全限制');
    }
    offset = next;
  }
  if (offset > centralOffset + centralSize) throw new Error('技能包 ZIP 目录损坏');
}

/** Bounded ZIP extraction shared by console, archive and sync/cache consumers. */
export function unzipNacosArtifact(zipBytes: Uint8Array): Record<string, Uint8Array> {
  if (zipBytes.byteLength > NACOS_ARTIFACT_MAX_BYTES) throw new Error('技能包超过 64MB 下载上限');
  inspectZip(zipBytes);
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(zipBytes);
  } catch {
    throw new Error('技能包不是合法的 ZIP 文件');
  }
  let expanded = 0;
  for (const [rawPath, data] of Object.entries(entries)) {
    const normalized = safeArchivePath(rawPath);
    if (!normalized) throw new Error('技能包包含非法成员路径');
    if (data.byteLength > NACOS_ZIP_MAX_FILE_BYTES) throw new Error('技能包单文件大小超出安全限制');
    expanded += data.byteLength;
    if (expanded > NACOS_ZIP_MAX_EXPANDED_BYTES) throw new Error('技能包解压总大小超出安全限制');
  }
  return entries;
}

async function validateArtifactUrl(rawUrl: string, trustedOrigin?: string): Promise<URL> {
  let url: URL;
  try { url = new URL(rawUrl); } catch { throw new Error('技能下载地址无效'); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('技能下载地址必须使用无凭据的 HTTPS');
  const hostname = url.hostname.toLowerCase().replace(/\.$/, '');
  const trusted = !!trustedOrigin && url.origin === trustedOrigin;
  if (!trusted) {
    if (!PUBLIC_ARTIFACT_HOSTS.has(hostname) || (url.port && url.port !== '443')) {
      throw new Error('技能下载主机不在允许列表');
    }
    if (isIP(hostname)) throw new Error('技能下载主机不在允许列表');
    let addresses;
    try { addresses = await lookup(hostname, { all: true }); } catch { throw new Error('技能下载主机无法解析'); }
    if (!addresses.length || addresses.some(({ address }) => isPrivateAddress(address))) {
      throw new Error('技能下载目标解析到非公网地址');
    }
  }
  return url;
}

async function readArtifactBody(response: Response): Promise<Uint8Array> {
  const declared = response.headers.get('content-length');
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > NACOS_ARTIFACT_MAX_BYTES)) {
    throw new Error('技能包超过 64MB 下载上限');
  }
  if (!response.body) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let completed = false;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { completed = true; break; }
      total += value.byteLength;
      if (total > NACOS_ARTIFACT_MAX_BYTES) throw new Error('技能包超过 64MB 下载上限');
      chunks.push(value);
    }
  } finally {
    if (!completed) await reader.cancel().catch(() => undefined);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

interface ArtifactFetchResult { bytes: Uint8Array; status: number; contentType: string; url: string }

async function fetchArtifact(
  rawUrl: string,
  trustedOrigin?: string,
  initialHeaders: Record<string, string> = {},
): Promise<ArtifactFetchResult> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_ARTIFACT_REDIRECTS; hop += 1) {
    const target = await validateArtifactUrl(current, trustedOrigin);
    const headers: Record<string, string> = {
      'User-Agent': 'agentteams-dashboard',
      Accept: 'application/zip,application/octet-stream',
    };
    // Console credentials are sent only to the configured origin, never to a redirect target.
    if (hop === 0 && target.origin === trustedOrigin) Object.assign(headers, initialHeaders);
    const response = await fetch(target, {
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(30000),
      headers,
    });
    const location = response.headers.get('location');
    if ([301, 302, 303, 307, 308].includes(response.status) && location) {
      await response.body?.cancel().catch(() => undefined);
      if (hop === MAX_ARTIFACT_REDIRECTS) throw new Error('技能下载重定向次数超限');
      current = new URL(location, target).toString();
      continue;
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new Error(`技能下载失败: HTTP ${response.status}`);
    }
    return {
      bytes: await readArtifactBody(response),
      status: response.status,
      contentType: response.headers.get('content-type') ?? '',
      url: redactNacosUrl(target.toString()),
    };
  }
  throw new Error('技能下载重定向次数超限');
}

export async function cacheSkillContent(
  client: Client,
  skillName: string,
  files: { relativePath: string; data: Uint8Array }[]
): Promise<void> {
  if (!isValidNameSegment(skillName)) throw new Error('非法技能名称');
  for (const file of files) {
    if (!safeArchivePath(file.relativePath) || file.data.byteLength > NACOS_ZIP_MAX_FILE_BYTES) {
      throw new Error('技能缓存包含非法成员');
    }
  }
  await deleteSkillCache(client, skillName);
  for (const file of files) {
    await client.putObject(
      SKILLS_BUCKET,
      `${skillName}/${file.relativePath}`,
      Buffer.from(file.data),
      file.data.byteLength,
      { 'Content-Type': 'application/octet-stream' },
    );
  }
}

async function deleteSkillCache(client: Client, skillName: string): Promise<void> {
  const prefix = `${skillName}/`;
  try {
    const objs: string[] = [];
    const stream = client.listObjects(SKILLS_BUCKET, prefix, true);
    await new Promise<void>((resolve, reject) => {
      stream.on('data', (obj: { name?: string }) => { if (obj.name) objs.push(obj.name); });
      stream.on('end', resolve);
      stream.on('error', reject);
    });
    if (objs.length > 0) await client.removeObjects(SKILLS_BUCKET, objs);
  } catch {
    // Write-through still works; stale objects are inert.
  }
}

/** Extract the single skill matching requestedName from a monorepo-style ZIP. */
function extractSkillFromMonorepo(
  zipBytes: Uint8Array,
  requestedName: string,
): { zipBytes: Uint8Array; resolvedName: string } {
  const entries = unzipNacosArtifact(zipBytes);
  const paths = Object.keys(entries);
  const directSkillMd = paths.find((path) => path === 'SKILL.md' || /^[^/]+\/SKILL\.md$/.test(path));
  if (directSkillMd) {
    const prefix = directSkillMd === 'SKILL.md' ? '' : directSkillMd.slice(0, -'SKILL.md'.length);
    const resolvedName = new TextDecoder().decode(entries[directSkillMd]).match(/^name:\s*(.+)$/m)?.[1]?.trim() || requestedName;
    return buildSingleSkillZip(entries, prefix, resolvedName);
  }
  let rootPrefix = '';
  for (const path of paths) {
    const slash = path.indexOf('/');
    if (slash > 0 && !path.startsWith('.github') && !path.startsWith('.claude-plugin')) {
      rootPrefix = path.substring(0, slash + 1);
      break;
    }
  }

  const dirPath = `${rootPrefix}skills/${requestedName}/`;
  if (paths.some((path) => path.startsWith(dirPath))) {
    return buildSingleSkillZip(entries, dirPath, requestedName);
  }

  for (const path of paths) {
    if (!path.includes('/skills/') || !path.endsWith('/SKILL.md')) continue;
    const nameMatch = new TextDecoder().decode(entries[path]).match(/^name:\s*(.+)$/m);
    if (!nameMatch || nameMatch[1].trim() !== requestedName) continue;
    const skillsIdx = path.indexOf('/skills/') + 8;
    const skillDir = path.substring(0, path.indexOf('/', skillsIdx) + 1);
    return buildSingleSkillZip(entries, skillDir, nameMatch[1].trim());
  }

  for (const path of paths) {
    if (!path.includes('/skills/') || !path.endsWith('/SKILL.md')) continue;
    const skillsIdx = path.indexOf('/skills/') + 8;
    const dirName = path.substring(skillsIdx, path.indexOf('/', skillsIdx));
    const nameMatch = new TextDecoder().decode(entries[path]).match(/^name:\s*(.+)$/m);
    const internalName = nameMatch?.[1]?.trim() || '';
    if (internalName && (
      requestedName.includes(internalName) || internalName.includes(requestedName) ||
      requestedName.replace(/[_-]/g, '') === internalName.replace(/[_-]/g, '')
    )) {
      return buildSingleSkillZip(entries, path.substring(0, skillsIdx + dirName.length + 1), internalName);
    }
  }

  const available = paths.flatMap((path) => {
    if (!path.includes('/skills/') || !path.endsWith('/SKILL.md')) return [];
    const parts = path.split('/');
    const index = parts.indexOf('skills');
    return index >= 0 && index + 1 < parts.length ? [parts[index + 1]] : [];
  });
  throw new Error(`无法在技能仓库中找到 "${requestedName}"（可用技能: ${[...new Set(available)].join(', ')}）`);
}

function buildSingleSkillZip(
  entries: Record<string, Uint8Array>,
  dirPrefix: string,
  resolvedName: string,
): { zipBytes: Uint8Array; resolvedName: string } {
  if (!isValidNameSegment(resolvedName)) throw new Error('技能包中的技能名不合法');
  const skillFiles: Record<string, Uint8Array> = {};
  for (const [path, data] of Object.entries(entries)) {
    if (!path.startsWith(dirPrefix) || path === dirPrefix) continue;
    const relative = path.substring(dirPrefix.length);
    if (safeArchivePath(relative)) skillFiles[relative] = data;
  }
  if (Object.keys(skillFiles).length === 0) throw new Error(`技能目录 "${dirPrefix}" 为空`);
  return { zipBytes: zipSync(skillFiles), resolvedName };
}

export async function getNacosAccessToken(config: NacosConfig): Promise<string> {
  const urlMatch = config.registryUrl.match(/^nacos:\/\/([^/]+)\/(.+)$/);
  if (!urlMatch || !config.username || !config.password) return '';
  try {
    const response = await nacosFetch(`${config.protocol || 'http'}://${urlMatch[1]}/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ username: config.username, password: config.password }).toString(),
      timeoutMs: 10000,
    });
    if (!response.ok) return '';
    const data = await readNacosJson<{ accessToken?: string }>(response);
    return typeof data.accessToken === 'string' ? data.accessToken : '';
  } catch {
    return '';
  }
}

async function fetchNacosSkillZipByConsoleDownload(
  apiBase: string,
  namespace: string,
  skillName: string,
  version: string,
  accessToken: string,
): Promise<NacosZipResult | null> {
  const params = new URLSearchParams({ namespaceId: namespace, skillName, version });
  const downloadUrl = `${apiBase}/v3/console/ai/skills/version/download?${params}`;
  const artifact = await fetchArtifact(
    downloadUrl,
    new URL(apiBase).origin,
    accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
  );
  if (!artifact.contentType.includes('zip') && !artifact.contentType.includes('octet-stream')) return null;
  const entries = unzipNacosArtifact(artifact.bytes);
  const stripped: Record<string, Uint8Array> = {};
  const prefix = `${skillName}/`;
  let resolvedName = skillName;
  for (const [path, data] of Object.entries(entries)) {
    if (!path.startsWith(prefix)) continue;
    const relative = path.substring(prefix.length);
    if (!safeArchivePath(relative)) continue;
    stripped[relative] = data;
    if (relative === 'SKILL.md') {
      const name = new TextDecoder().decode(data).match(/^name:\s*(.+)$/m)?.[1]?.trim();
      if (name && isValidNameSegment(name)) resolvedName = name;
    }
  }
  if (Object.keys(stripped).length === 0) return null;
  return { zipBytes: zipSync(stripped), resolvedName, source: 'nacos-console' };
}

function githubCandidates(from: string, version: string): string[] {
  let repository: string;
  try {
    const parsed = new URL(from.includes('://') ? from : `https://${from}`);
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'github.com' || parsed.username || parsed.password) return [];
    repository = parsed.pathname.replace(/^\/+|\/+$/g, '');
  } catch { return []; }
  const parts = repository.split('/');
  if (parts.length !== 2 || parts.some((part) => !/^[A-Za-z0-9._-]+$/.test(part))) return [];
  if (!/^[A-Za-z0-9._-]+$/.test(version)) return [];
  return [
    `https://github.com/${repository}/archive/refs/tags/${version}.zip`,
    `https://github.com/${repository}/archive/refs/heads/${version}.zip`,
    `https://github.com/${repository}/archive/refs/heads/main.zip`,
  ];
}

export async function fetchNacosSkillZip(
  skillName: string,
  config?: NacosConfig | null,
  preFetchedAccessToken?: string,
): Promise<NacosZipResult> {
  if (!config) {
    config = await getNacosConfig();
    if (!config) throw new Error('Nacos 未配置');
  }
  const protocol = config.protocol || 'http';
  const prefix = config.apiPrefix ?? '/nacos';
  const mode = config.mode || 'services';
  const urlMatch = config.registryUrl.match(/^nacos:\/\/([^/]+)\/(.+)$/);
  if (!urlMatch) throw new Error('Nacos URL 格式无效');
  const [, hostPort, namespace] = urlMatch;
  const apiBase = `${protocol}://${hostPort}`;
  const accessToken = preFetchedAccessToken ?? await getNacosAccessToken(config);
  const nsParam = `namespaceId=${encodeURIComponent(namespace)}`;
  const authHeaders: Record<string, string> = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const diag: NacosFetchDiagnostics = { mode };

  if (mode === 'skills') {
    const listUrl = `${apiBase}/v3/console/ai/skills/list?filterableForm=true&pageNo=1&pageSize=500&${nsParam}`;
    diag.skillsDetailUrl = redactNacosUrl(listUrl);
    try {
      const response = await nacosFetch(listUrl, { accessToken, headers: { 'Content-Type': 'application/json' } });
      diag.skillsDetailStatus = response.status;
      if (response.ok) {
        const listData = await readNacosJson<{ code?: number; data?: { pageItems?: Array<{ name: string; from?: string; labels?: { latest?: string } }> } }>(response, accessToken);
        diag.skillsDetailCode = listData.code;
        if (listData.code === 0 && listData.data?.pageItems) {
          const skill = listData.data.pageItems.find((item) => item.name === skillName);
          if (!skill) throw new Error(`技能 "${skillName}" 未在 Nacos 中注册`);
          const version = skill.labels?.latest;
          if (version) {
            try {
              const result = await fetchNacosSkillZipByConsoleDownload(apiBase, namespace, skillName, version, accessToken);
              if (result) return result;
            } catch { /* fall through to a public archive */ }
          }
          if (skill.from) {
            for (const githubUrl of githubCandidates(skill.from, version || 'main')) {
              diag.homePageUrl = githubUrl;
              try {
                const artifact = await fetchArtifact(githubUrl);
                diag.homePageStatus = artifact.status;
                const extracted = extractSkillFromMonorepo(artifact.bytes, skillName);
                return { zipBytes: extracted.zipBytes, resolvedName: extracted.resolvedName, source: 'github-archive' };
              } catch (err) {
                diag.homePageStatus = -1;
                diag.homePageError = sanitizeNacosText(err instanceof Error ? err.message : 'unknown', [accessToken]);
              }
            }
          }
        }
      }
    } catch { diag.skillsDetailStatus = -1; }
  }

  if (mode === 'services') {
    const listUrl = `${apiBase}${prefix}/v1/ns/catalog/services?pageNo=1&pageSize=500&${nsParam}`;
    diag.servicesListUrl = redactNacosUrl(listUrl);
    try {
      const response = await nacosFetch(listUrl, { accessToken, headers: authHeaders });
      diag.servicesListStatus = response.status;
      if (response.ok) {
        const data = await readNacosJson<{ code?: number; data?: { serviceList?: Record<string, unknown>[] } }>(response, accessToken);
        if (data.code === 200 && Array.isArray(data.data?.serviceList)) {
          const service = data.data.serviceList.find((item) => item.name === skillName || item.serviceName === skillName);
          diag.serviceFound = !!service;
          if (service) {
            const homePageUrl = typeof service.homePageUrl === 'string' ? service.homePageUrl : '';
            diag.hasHomePageUrl = !!homePageUrl;
            diag.homePageUrl = redactNacosUrl(homePageUrl, [accessToken]);
            if (homePageUrl) {
              try {
                const artifact = await fetchArtifact(homePageUrl, new URL(apiBase).origin);
                diag.homePageStatus = artifact.status;
                diag.homePageContentType = artifact.contentType;
                if (artifact.contentType.includes('zip')) {
                  const extracted = extractSkillFromMonorepo(artifact.bytes, skillName);
                  return { zipBytes: extracted.zipBytes, resolvedName: extracted.resolvedName, source: 'homePageUrl' };
                }
              } catch (err) {
                diag.homePageStatus = -1;
                diag.homePageError = sanitizeNacosText(err instanceof Error ? err.message : 'unknown', [accessToken]);
              }
            }
          }
        }
      }
    } catch { diag.servicesListStatus = -1; }
  }

  const safeDiag = sanitizeNacosText(JSON.stringify(diag), [accessToken]);
  throw new Error(`无法从 Nacos 获取技能 "${skillName}" 的内容。诊断: ${safeDiag}`);
}
