import { createHash } from 'node:crypto';
import { zipSync } from 'fflate';
import { parseDocument, isMap } from 'yaml';
import { getNacosConfig } from '@/lib/skill-center-config';
import { isValidNameSegment, parseSkillPackage, SKILL_PACKAGE_MAX_BYTES } from '@/lib/skill-package';

export class SkillError extends Error {
  readonly status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export type Files = Map<string, Buffer>;
export function compareSkillFiles(local: Files, upstream: Files) {
  const differences = [];
  for (const path of [...new Set([...local.keys(), ...upstream.keys()])].sort()) {
    const before = local.get(path), after = upstream.get(path);
    if (before && after && before.equals(after)) continue;
    differences.push({ path, change: !before ? 'added' : !after ? 'removed' : 'modified' });
  }
  return differences;
}

export function filePreview(bytes: Buffer | undefined) {
  if (!bytes) return null;
  const text = bytes.length <= 1024 * 1024 && !bytes.includes(0) ? bytes.toString('utf8') : null;
  if (text !== null && Buffer.from(text).equals(bytes)) return { size: bytes.length, text };
  return { size: bytes.length, text: null, sha256: createHash('sha256').update(bytes).digest('hex') };
}
export const skillMedia = 'application/agent-skills+zip';
export const hashes = (files: Files) => Object.fromEntries([...files].sort(([a], [b]) => a < b ? -1 : 1)
  .map(([path, data]) => [path, createHash('sha256').update(data).digest('hex')]));
export const fingerprint = (files: Files) => createHash('sha256').update(JSON.stringify(hashes(files))).digest('hex');

function frontmatter(files: Files) {
  const text = files.get('SKILL.md')?.toString('utf8') || '';
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?=\r?\n|$)/.exec(text);
  if (!match) throw new SkillError('SKILL.md 缺少 YAML 元数据');
  const doc = parseDocument(match[1]);
  if (doc.errors.length || !isMap(doc.contents)) throw new SkillError('SKILL.md 元数据无效');
  return { doc, match, text };
}

export function localVersion(files: Files) {
  return files.size ? String(frontmatter(files).doc.get('version') ?? '') : '';
}

export function publicationZip(name: string, files: Files, version: string, edits: Record<string, string>) {
  const content = new Map(files);
  for (const [path, value] of Object.entries(edits)) {
    const old = files.get(path);
    if (!old || typeof value !== 'string' || old.includes(0) || !Buffer.from(old.toString('utf8')).equals(old)) {
      throw new SkillError('只能编辑已有的 UTF-8 文本文件');
    }
    content.set(path, Buffer.from(value));
  }
  const { doc, match, text } = frontmatter(content);
  if (doc.get('name') !== name) throw new SkillError('SKILL.md 的资源名称与发布目标不同');
  doc.set('version', version);
  content.set('SKILL.md', Buffer.from('---\n' + doc.toString() + '---' + text.slice(match[0].length)));
  if ([...content.values()].reduce((sum, file) => sum + file.length, 0) > SKILL_PACKAGE_MAX_BYTES) {
    throw new SkillError('工作区 Skill 超过大小限制');
  }
  return zipSync(Object.fromEntries([...content].map(([p, b]) => [name + '/' + p, b])));
}

interface Entry {
  identifier: string; version: string; type: string; url: string; description?: string;
  metadata: { namespaceId: string; resourceName: string };
}
export interface SkillItem { name: string; version: string; source: string; description: string }
interface SkillMeta {
  labels?: { latest?: string }; editingVersion?: string; reviewingVersion?: string;
  versions: { version: string; status: string }[];
}

export async function openNacosSkills() {
  const config = await getNacosConfig();
  if (!config) throw new SkillError('请先配置 Nacos 连接', 409);
  const host = new URL(config.registryUrl).host;
  const server = new URL((config.protocol || 'http') + '://' + host);
  const api = server.origin + '/' + (config.apiPrefix ?? '/nacos').split('/').filter(Boolean).concat('v3').join('/');
  server.port = '9080';
  const base = (config.ardBaseUrl || server.origin).replace(/\/+$/, '');
  const ard = base + '/v3/ai/ard';
  const namespace = config.namespace || 'public';
  const auth = new Headers();

  async function call(url: string, options: RequestInit = {}, allowNotFound = false) {
    const headers = new Headers(options.headers || {});
    auth.forEach((v, k) => headers.set(k, v));
    const r = await fetch(url, { ...options, headers, redirect: 'error', cache: 'no-store', signal: AbortSignal.timeout(25000) });
    if (!r.ok && !(allowNotFound && r.status === 404)) throw new SkillError('Nacos ' + r.status + ' · ' + new URL(url).pathname, r.status);
    return r;
  }
  if (config.username) {
    const r = await call(api + '/auth/user/login', { method: 'POST', body: new URLSearchParams({
      username: config.username, password: config.password || '',
    }) });
    const { accessToken } = await r.json();
    if (typeof accessToken !== 'string' || !accessToken) throw new SkillError('Nacos 登录失败', 401);
    auth.set('Authorization', 'Bearer ' + accessToken);
  }

  async function catalog(query: string, pageToken = '') {
    const params = new URLSearchParams({ namespaceId: namespace });
    let response;
    if (query) {
      response = await call(ard + '/search?' + params, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: { text: query, filter: { type: [skillMedia] } }, pageSize: 50, pageToken: pageToken || undefined }) });
    } else {
      params.set('filter', "type = '" + skillMedia + "'");
      params.set('pageSize', '50');
      if (pageToken) params.set('pageToken', pageToken);
      response = await call(ard + '/agents?' + params);
    }
    const data = await response.json();
    const entries: Entry[] = query ? data.results : data.items;
    if (!Array.isArray(entries)) throw new SkillError('ARD 目录响应无效', 502);
    return { entries: entries.filter(e => e.type === skillMedia && e.metadata?.namespaceId === namespace
      && isValidNameSegment(e.metadata.resourceName) && e.identifier && e.version), next: data.pageToken || '' };
  }
  function item(entry: Entry): SkillItem {
    return { name: entry.metadata.resourceName, version: entry.version, description: entry.description || '',
      source: JSON.stringify([base, namespace, entry.identifier]) };
  }
  async function find(name: string) {
    let page = '';
    const seen = new Set<string>();
    do {
      const result = await catalog(name, page);
      const entry = result.entries.find(e => e.metadata.resourceName === name);
      if (entry) return entry;
      seen.add(page);
      page = result.next;
    } while (page && !seen.has(page));
    return null;
  }
  async function resolve(name: string, source: string) {
    const entry = await find(name);
    if (!entry || item(entry).source !== source) throw new SkillError('当前来源中找不到所选 Skill，请重新发现', 409);
    return entry;
  }
  async function download(entry: Entry, version = entry.version): Promise<Files> {
    const name = entry.metadata.resourceName;
    const url = version === entry.version ? new URL(entry.url)
      : new URL(api + '/client/ai/skills?' + new URLSearchParams({ namespaceId: namespace, name, version }));
    if (version === entry.version && (url.origin !== new URL(base).origin || !url.pathname.startsWith(new URL(ard).pathname + '/'))) {
      throw new SkillError('制品 URL 与配置的 ARD 地址不一致', 502);
    }
    const r = await call(url.href);
    if (Number(r.headers.get('content-length')) > SKILL_PACKAGE_MAX_BYTES) throw new SkillError('Skill 包超过大小限制');
    const parsed = parseSkillPackage(new Uint8Array(await r.arrayBuffer()));
    const files = new Map(parsed.files.map(f => [f.relativePath, Buffer.from(f.data)]));
    if (parsed.skillName !== name || localVersion(files) !== version) throw new SkillError('下载的包与资源名称或版本不一致', 409);
    return files;
  }
  async function admin(path: string, options: RequestInit = {}) {
    const result = await (await call(api + '/admin/ai/skills' + path, options)).json();
    if (result.code !== 0) throw new SkillError('Nacos · ' + (result.message || '操作失败'), 502);
    return result.data;
  }
  const params = (name: string) => new URLSearchParams({ namespaceId: namespace, skillName: name });
  async function meta(name: string): Promise<SkillMeta | null> {
    const r = await call(api + '/admin/ai/skills?' + params(name), {}, true);
    const result = await r.json();
    if (r.status === 404 && result.code === 20004) return null;
    if (!r.ok || result.code !== 0 || !Array.isArray(result.data?.versions)) throw new SkillError('读取 Nacos Skill 元数据失败', r.ok ? 502 : r.status);
    return result.data;
  }
  async function versionDigest(name: string, version: string) {
    const query = params(name);
    query.set('version', version);
    const r = await call(api + '/admin/ai/skills/version/download?' + query);
    return packageDigest(new Uint8Array(await r.arrayBuffer()), name);
  }
  async function transition(name: string, version: string, action: 'submit' | 'publish') {
    const body = params(name);
    body.set('version', version);
    await admin('/' + action, { method: 'POST', body });
  }
  async function createDraft(name: string, version: string, message: string, zip: Uint8Array) {
    const body = new FormData();
    for (const [k, v] of params(name)) body.set(k, v);
    body.set('uploadAction', 'CREATE_DRAFT');
    body.set('autoPublishIfNew', 'false');
    body.set('targetVersion', version);
    body.set('commitMsg', message);
    body.set('file', new Blob([Uint8Array.from(zip)], { type: 'application/zip' }), name + '.zip');
    await admin('/upload', { method: 'POST', body });
    if ((await meta(name))?.editingVersion !== version) throw new SkillError('草稿版本回读不一致', 409);
  }
  return { catalog, item, find, resolve, download, meta, transition, createDraft, versionDigest, namespace, base, api };
}

export function packageDigest(zip: Uint8Array, name: string) {
  const parsed = parseSkillPackage(zip);
  if (parsed.skillName !== name) throw new SkillError('包内资源名称不同', 409);
  return fingerprint(new Map(parsed.files.map(f => [f.relativePath, Buffer.from(f.data)])));
}
