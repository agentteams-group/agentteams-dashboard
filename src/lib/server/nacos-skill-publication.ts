import { createHash } from 'node:crypto';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { SKILLS_BUCKET, SKILLS_METADATA_PREFIX, GLOBAL_SKILLS_PREFIX, CUSTOM_SKILL_MARKER } from '@/lib/skill-center-types';
import { SKILL_PACKAGE_MAX_BYTES, skillObjectKey } from '@/lib/skill-package';
import { SkillError, type Files, type openNacosSkills } from './nacos-ard';

type Nacos = Awaited<ReturnType<typeof openNacosSkills>>;
type Meta = Awaited<ReturnType<Nacos['meta']>>;
export interface Publication { version: string; base: string; source: string; digest: string; message: string }

async function readOptional(client: ReturnType<typeof createMinioClient>, bucket: string, key: string) {
  try {
    const chunks = [];
    for await (const chunk of await client.getObject(bucket, key)) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  } catch (error) {
    if (['NoSuchKey', 'NotFound', 'NoSuchBucket'].includes((error as { code?: string }).code || '')) return null;
    throw error;
  }
}

export async function localCatalogFiles(name: string): Promise<Files> {
  const client = createMinioClient();
  const metadata = await readOptional(client, SKILLS_BUCKET, SKILLS_METADATA_PREFIX + name + '.json');
  const bucket = metadata ? SKILLS_BUCKET : getMinioBucket();
  const prefix = metadata ? name + '/' : GLOBAL_SKILLS_PREFIX + name + '/';
  if (!bucket) throw new SkillError('技能存储未配置', 503);
  const custom = metadata ? JSON.parse(metadata.toString()).source === 'custom'
    : !!await readOptional(client, bucket, prefix + CUSTOM_SKILL_MARKER);
  if (!custom) throw new SkillError('请选择技能中心的自定义 Skill', 409);
  const files: Files = new Map();
  let total = 0;
  for await (const object of client.listObjectsV2(bucket, prefix, true)) {
    if (!object.name || object.name.endsWith('/')) continue;
    const path = object.name.slice(prefix.length);
    if (path === CUSTOM_SKILL_MARKER) continue;
    skillObjectKey('catalog', name, path);
    total += object.size;
    if (total > SKILL_PACKAGE_MAX_BYTES) throw new SkillError('技能包超过大小限制');
    const bytes = await readOptional(client, bucket, object.name);
    if (!bytes) throw new SkillError('文件已变化，请重新读取', 409);
    files.set(path, bytes);
  }
  if (!files.has('SKILL.md')) throw new SkillError('本地包缺少 SKILL.md', 409);
  return files;
}

export async function publicationStore(nacos: Nacos, name: string, worker: string) {
  const client = createMinioClient(), bucket = getMinioBucket();
  if (!bucket) throw new SkillError('发布记录存储未配置', 503);
  const registry = createHash('sha256').update(JSON.stringify([nacos.api, nacos.base, nacos.namespace])).digest('hex');
  const key = 'skills/nacos-ard/publications/' + registry + '/' + (worker ? 'workers/' + worker : 'catalog') + '/' + name;
  const stored = await readOptional(client, bucket, key + '.json');
  const record: Publication | null = stored && JSON.parse(stored.toString());
  const link = await readOptional(client, bucket, key + '.source');
  return {
    record, source: link?.toString() || record?.source || '',
    save: async (data: Publication) => { await client.putObject(bucket, key + '.json', Buffer.from(JSON.stringify(data))); },
    associate: async (source: string) => {
      if (link && link.toString() !== source) throw new SkillError('原资源标识已变化', 409);
      if (!link) await client.putObject(bucket, key + '.source', Buffer.from(source));
    },
  };
}

export function publicationStatus(meta: Meta, version: string) {
  if (meta?.editingVersion === version) return 'draft';
  return meta?.versions.find(v => v.version === version)?.status || 'missing';
}

export async function publishDraft(nacos: Nacos, name: string, next: Publication, previous: Publication | null,
  zip: Uint8Array, save: (_record: Publication) => Promise<void>) {
  const meta = await nacos.meta(name);
  const status = publicationStatus(meta, next.version);
  if (status !== 'missing' && previous?.version === next.version && previous.digest === next.digest &&
      previous.message === next.message && previous.base === next.base && previous.source === next.source) {
    if (await nacos.versionDigest(name, next.version) !== next.digest) throw new SkillError('远端版本内容已改变', 409);
    return status;
  }
  if (!next.base && meta) throw new SkillError('Nacos 已存在同名资源，无法首次发布', 409);
  if ((meta?.labels?.latest || '') !== next.base || meta?.editingVersion || meta?.reviewingVersion || status !== 'missing') {
    throw new SkillError('上游版本已改变、版本号已存在或已有发布流程', 409);
  }
  await save(next);
  await nacos.createDraft(name, next.version, next.message, zip);
  return 'draft';
}

export async function resumePublication(nacos: Nacos, name: string, record: Publication) {
  const meta = await nacos.meta(name);
  const status = publicationStatus(meta, record.version);
  if (status === 'missing') throw new SkillError('Nacos 尚无这份草稿，请重新创建', 409);
  if (await nacos.versionDigest(name, record.version) !== record.digest) {
    throw new SkillError('远端内容与本地发布记录不一致，请在 Nacos 核对', 409);
  }
  if (status !== 'draft' && status !== 'reviewed') return status;
  if ((meta?.labels?.latest || '') !== record.base) {
    throw new SkillError('发布基线已变化，请在 Nacos 核对', 409);
  }
  await nacos.transition(name, record.version, status === 'draft' ? 'submit' : 'publish');
  return publicationStatus(await nacos.meta(name), record.version);
}
