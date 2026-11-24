import { NextRequest } from 'next/server';
import { createMinioClient, getMinioBucket } from '@/lib/minio-client';
import { getControllerUrl, proxyToAgentTeams } from '@/app/api/agentteams/proxy-helper';
import { restartWorkerForSkillReload } from '@/lib/worker-restart';
import { skillObjectKey, SKILL_PACKAGE_MAX_BYTES } from '@/lib/skill-package';
import { SkillError, fingerprint, hashes, localVersion, openNacosSkills, type Files } from './nacos-ard';

type Nacos = Awaited<ReturnType<typeof openNacosSkills>>;
type Entry = Awaited<ReturnType<Nacos['resolve']>>;
interface Binding {
  source: string; version: string;
  pending?: { version: string; before: Record<string, string>; after: Record<string, string> };
}

async function controller(request: NextRequest, worker: string, suffix = '', data?: object) {
  const req = data ? new NextRequest(request.url, { method: 'PUT', headers: request.headers, body: JSON.stringify(data) }) : request;
  const r = await proxyToAgentTeams(req, getControllerUrl(request), '/api/v1/workers/' + encodeURIComponent(worker) + suffix,
    { method: data ? 'PUT' : 'GET', forwardBody: !!data });
  if (!r.ok) throw new SkillError('Controller · ' + r.status + ' · ' + (await r.text()).slice(0, 180), r.status);
  return r.status === 204 ? {} : r.json();
}

export const readSkillWorker = (request: NextRequest, worker: string) => controller(request, worker);

export async function workerSkill(request: NextRequest, worker: string, nacos: Nacos, entry: Entry) {
  const descriptor = nacos.item(entry);
  const name = descriptor.name;
  // Controller enforces the caller's Worker scope before any direct storage read.
  const spec = await controller(request, worker);
  const client = createMinioClient();
  const bucket = getMinioBucket();
  if (!bucket) throw new SkillError('工作区存储未配置', 503);
  const prefix = skillObjectKey(worker, name, 'SKILL.md').slice(0, -'SKILL.md'.length);
  const key = 'skills/nacos-ard/bindings/' + worker + '/' + name + '.json';
  const read = async (object: string) => {
    const chunks = [];
    for await (const chunk of await client.getObject(bucket, object)) chunks.push(Buffer.from(chunk));
    return Buffer.concat(chunks);
  };
  let binding: Binding | null = null;
  try {
    binding = JSON.parse((await read(key)).toString());
  } catch (e) {
    if (!['NoSuchKey', 'NotFound'].includes((e as {code?: string}).code || '')) throw e;
  }
  const save = (record: Binding) => client.putObject(bucket, key, Buffer.from(JSON.stringify(record)));
  const files: Files = new Map();
  let total = 0;
  for await (const object of client.listObjectsV2(bucket, prefix, true)) {
    if (!object.name || object.name.endsWith('/')) continue;
    total += object.size;
    if (total > SKILL_PACKAGE_MAX_BYTES) throw new SkillError('工作区 Skill 超过大小限制');
    const path = object.name.slice(prefix.length);
    if (skillObjectKey(worker, name, path) !== object.name) throw new SkillError('工作区存在无效的文件路径');
    files.set(path, await read(object.name));
  }
  const digest = fingerprint(files);
  let conflict = '', version = '';
  try { version = files.has('SKILL.md') ? localVersion(files) : ''; }
  catch (e) { conflict = e instanceof Error ? e.message : '工作区元数据无效'; }
  const baseline = binding?.version || version;
  const prepared = hashes(files);
  const pending = binding?.pending;
  const recoverable = pending?.version === entry.version && [...new Set([
    ...Object.keys(prepared), ...Object.keys(pending.before), ...Object.keys(pending.after),
  ])].every(p => prepared[p] === pending.before[p] || prepared[p] === pending.after[p]);
  if (binding && binding.source !== descriptor.source) conflict = '已关联其他 Nacos 来源';
  else if (pending && !recoverable) conflict = '上次更新未完成，工作区或上游已变化';
  else if (!conflict && baseline && !recoverable) {
    try {
      if (fingerprint(await nacos.download(entry, baseline)) !== digest) conflict = '工作区已修改';
    } catch (e) { conflict = '无法核对工作区基线：' + (e instanceof Error ? e.message : baseline); }
  } else if (!conflict && !baseline && files.size && !recoverable) conflict = '无法确认工作区基线版本';
  if (spec.remoteSkills?.some((r: {skills?: {name: string}[]}) => r.skills?.some(s => s.name === name))) {
    conflict = '该 Skill 由 Worker remoteSkills 配置管理';
  }

  async function runtime() {
    const rows = await controller(request, worker, '/skills');
    if (!Array.isArray(rows)) throw new SkillError('运行时响应无效', 502);
    const row = rows.find(r => r.name === name);
    return { installed: !!row, enabled: row?.enabled === true, version: String(row?.version_text || '') };
  }
  async function apply(expected: string) {
    if (digest !== expected || conflict) throw new SkillError(conflict || '工作区已变化，请刷新', 409);
    const next = await nacos.download(entry);
    if (!pending && spec.skills?.includes(name) && fingerprint(next) === digest) {
      const current = await runtime();
      if (current.enabled && current.version === entry.version) {
        if (!binding || binding.version !== entry.version) await save({ source: descriptor.source, version: entry.version });
        return;
      }
    }
    const after = hashes(next);
    await save({ source: descriptor.source, version: baseline, pending: { version: entry.version,
      before: recoverable && pending ? pending.before : prepared, after } });
    // Keep the marker outside the deployed tree. A retry can finish a partial copy.
    for (const [path, data] of next) {
      if (after[path] !== prepared[path]) await client.putObject(bucket!, prefix + path, data);
    }
    for (const path of files.keys()) if (!next.has(path)) await client.removeObject(bucket!, prefix + path);
    const latestSpec = await controller(request, worker);
    const skills: string[] = latestSpec.skills || [];
    if (!skills.includes(name)) await controller(request, worker, '', { skills: [...skills, name] });
    await save({ source: descriptor.source, version: entry.version });
    const restarted = await restartWorkerForSkillReload(worker, undefined, request);
    if (!restarted.ok) throw new SkillError(restarted.error || '等待 Agent 加载失败', 502);
  }
  return { files, digest, version, baseline, conflict, runtime, apply, bound: binding?.source === descriptor.source,
    incomplete: !!pending, recordSource: () => save({ source: descriptor.source, version: baseline }) };
}
