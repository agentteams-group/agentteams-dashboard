import { NextRequest, NextResponse } from 'next/server';
import { enforceLevelOnlyRbac, enforceServerSideRbac } from '@/lib/server-auth';
import { isValidNameSegment } from '@/lib/skill-package';
import { compareSkillFiles, filePreview, fingerprint, openNacosSkills, packageDigest, publicationZip, SkillError, type Files } from '@/lib/server/nacos-ard';
import { localCatalogFiles, publicationStatus, publicationStore, publishDraft, resumePublication } from '@/lib/server/nacos-skill-publication';
import { readSkillWorker, workerSkill } from '@/lib/server/nacos-worker-skill';

export const dynamic = 'force-dynamic';
const active = new Set<string>();
const json = NextResponse.json;
const valid = (v: unknown): v is string => typeof v === 'string' && isValidNameSegment(v);
const registryKey = (n: Awaited<ReturnType<typeof openNacosSkills>>) => JSON.stringify([n.api, n.base, n.namespace]);
function failure(error: unknown) {
  return json({ error: error instanceof Error ? error.message : '请求失败' },
    { status: error instanceof SkillError ? error.status : 502 });
}
function draftFile(files: Files, file: string) {
  if (!files.has(file)) throw new SkillError('包内文件不存在', 404);
  return { paths: [...files.keys()].sort(), path: file, text: filePreview(files.get(file))?.text ?? null, digest: fingerprint(files) };
}

export async function GET(request: NextRequest) {
  try {
    const denied = await enforceLevelOnlyRbac(request, 'view', 'skill', 'nacos-ard');
    if (denied) return denied;
    const p = request.nextUrl.searchParams;
    const nacos = await openNacosSkills();
    const local = p.get('local') === '1', worker = p.get('worker') || '', name = p.get('name') || '';
    if (!local && !p.has('worker')) {
      const { entries, next } = await nacos.catalog(p.get('q')?.trim() || '', p.get('page') || '');
      return json({ skills: entries.map(nacos.item), next, registry: nacos.base, namespace: nacos.namespace });
    }
    if (!valid(name) || (local ? !!worker : !valid(worker))) throw new SkillError('无效的 Agent 或 Skill 名称');
    if (!local) {
      const forbidden = await enforceServerSideRbac(request, 'view', 'worker', worker);
      if (forbidden) return forbidden;
    }
    if (p.has('receipt')) {
      if (worker) await readSkillWorker(request, worker);
      const store = await publicationStore(nacos, name, worker);
      const rec = store.record;
      const registry = registryKey(nacos);
      if (!rec) return json({ registry, receipt: null });
      const meta = await nacos.meta(name);
      const status = publicationStatus(meta, rec.version);
      const found = status === 'online' ? await nacos.find(name) : null;
      let source = store.source;
      if (found) {
        const id = nacos.item(found).source;
        if (source && id !== source) throw new SkillError('已关联资源的标识发生变化', 409);
        if (!source) {
          if (await nacos.versionDigest(name, rec.version) !== rec.digest) throw new SkillError('已上线内容与本地发布记录不一致', 409);
          await store.associate(id);
        }
        source = id;
      }
      return json({ registry, receipt: { version: rec.version, base: rec.base, message: rec.message, status,
        source, latest: meta?.labels?.latest || '', upstream: found?.version || '', discovered: found?.version === rec.version } });
    }
    const file = p.get('file') || 'SKILL.md';
    if (local) return json(draftFile(await localCatalogFiles(name), file));
    const entry = await nacos.resolve(name, p.get('source') || '');
    const state = await workerSkill(request, worker, nacos, entry);
    if (p.has('diff')) {
      if (p.get('expected') !== entry.version || p.get('digest') !== state.digest) throw new SkillError('版本或工作区已变化，请刷新差异', 409);
      const upstream = await nacos.download(entry);
      const changes = compareSkillFiles(state.files, upstream);
      if (!p.has('file')) return json({ changes });
      if (!changes.some(change => change.path === file)) throw new SkillError('该文件没有差异', 404);
      return json({ before: filePreview(state.files.get(file)), after: filePreview(upstream.get(file)) });
    }
    if (p.has('edit')) {
      if (state.incomplete || (state.conflict && !(state.conflict === '工作区已修改' && state.bound))) throw new SkillError(state.conflict || '上次更新尚未完成', 409);
      return json({ ...draftFile(state.files, file), version: state.baseline });
    }
    let observed = null, runtimeError = '';
    try { observed = await state.runtime(); } catch (e) { runtimeError = e instanceof Error ? e.message : '检测失败'; }
    return json({ observed, runtimeError, workspace: state.version, digest: state.digest, conflict: state.conflict,
      incomplete: state.incomplete, upstream: entry.version, bound: state.bound });
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  const locks: string[] = [];
  try {
    const { action, worker = '', local = false, name, source = '', expected, digest, version, message, edits = {}, registry } = await request.json();
    if (!['apply', 'publish', 'finish'].includes(action) || !valid(name) || typeof local !== 'boolean' ||
        (local === true ? worker !== '' || action === 'apply' : !valid(worker))) throw new SkillError('无效的操作或资源名称');
    if (worker) {
      const denied = await enforceServerSideRbac(request, 'update', 'worker', worker);
      if (denied) return denied;
    }
    const globalDenied = await enforceLevelOnlyRbac(request, action === 'apply' ? 'view' : 'update', 'skill', name);
    if (globalDenied) return globalDenied;
    const nacos = await openNacosSkills();
    if (action !== 'apply' && registry !== registryKey(nacos)) throw new SkillError('Nacos 连接已改变，请重新打开发布面板', 409);
    const keys = worker ? ['worker/' + worker] : [];
    if (action !== 'apply') keys.push(registryKey(nacos) + '/' + name);
    if (keys.some(key => active.has(key))) throw new SkillError('该资源正在处理，请稍后重试', 409);
    for (const key of keys) { active.add(key); locks.push(key); }
    if (action === 'apply') {
      const entry = await nacos.resolve(name, source);
      if (entry.version !== expected) throw new SkillError('上游版本已变化，请刷新后查看', 409);
      await (await workerSkill(request, worker, nacos, entry)).apply(digest);
      return json({ status: '等待运行时确认' });
    }
    if (typeof version !== 'string' || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) throw new SkillError('请填写有效的新版本号');
    if (worker) await readSkillWorker(request, worker);
    const store = await publicationStore(nacos, name, worker);
    if (action === 'finish') {
      if (!store.record || store.record.version !== version || (worker && store.record.source !== source)) throw new SkillError('没有匹配的发布记录', 409);
      return json({ status: await resumePublication(nacos, name, store.record) });
    }
    if (typeof message !== 'string' || !message.trim() || !edits || typeof edits !== 'object' || Array.isArray(edits)) throw new SkillError('请填写变更说明并确认编辑内容');
    let files: Files;
    let binding = source;
    if (local) {
      const rec = store.record;
      const base = rec && (await nacos.meta(name))?.labels?.latest === rec.version ? rec.version : rec?.base || '';
      if (expected !== base || (base && !store.source)) throw new SkillError('本地发布基线已变化，请刷新发布记录', 409);
      binding = store.source;
      if (base) await nacos.resolve(name, binding);
      files = await localCatalogFiles(name);
    } else {
      const entry = await nacos.resolve(name, source);
      const state = await workerSkill(request, worker, nacos, entry);
      if (entry.version !== expected || state.baseline !== expected || state.incomplete ||
          (state.conflict && !(state.bound && state.conflict === '工作区已修改'))) throw new SkillError('来源、上游或工作区与编辑基线不一致', 409);
      if (state.digest !== digest) throw new SkillError('工作区已变化，请重新打开编辑器', 409);
      await state.recordSource();
      files = state.files;
    }
    if (fingerprint(files) !== digest) throw new SkillError('本地内容已变化，请重新打开编辑器', 409);
    const zip = publicationZip(name, files, version, edits);
    return json({ status: await publishDraft(nacos, name, { source: binding, base: expected, version,
      digest: packageDigest(zip, name), message: message.trim() }, store.record, zip, store.save) });
  } catch (error) { return failure(error); }
  finally { locks.forEach(key => active.delete(key)); }
}
