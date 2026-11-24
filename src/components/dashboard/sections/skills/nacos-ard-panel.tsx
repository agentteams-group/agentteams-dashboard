'use client';

import { useEffect, useState } from 'react';
import { useInfiniteQuery, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useWorkers } from '@/hooks/use-agentteams-workers';
import { apiUrl } from '@/lib/api-base';
import type { SkillItem } from '@/lib/server/nacos-ard';

type Observed = { enabled: boolean; installed: boolean; version: string };
interface State {
  workspace: string; upstream: string; digest: string; conflict: string; incomplete: boolean; bound: boolean;
  observed: Observed | null; runtimeError: string;
}
interface Draft { paths: string[]; path: string; text: string | null; digest: string; version: string }
interface Catalog { skills: SkillItem[]; next: string; registry: string; namespace: string }
const endpoint = '/api/agentteams/skills/nacos/ard';

async function ard<T>(params: Record<string, string>, body?: object): Promise<T> {
  const response = await fetch(apiUrl(endpoint) + '?' + new URLSearchParams(params), body
    ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
    : { cache: 'no-store' });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || '请求失败');
  return data;
}

const errorText = (e: unknown) => e instanceof Error ? e.message : '请求失败';

export function NacosArdPanel() {
  const [text, setText] = useState('');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<SkillItem | null>(null);
  const qc = useQueryClient();
  const catalog = useInfiniteQuery({
    queryKey: ['ard-catalog', query], initialPageParam: '',
    queryFn: ({ pageParam }) => ard<Catalog>({ q: query, page: pageParam }),
    getNextPageParam: page => page.next || undefined, retry: false,
  });
  const items = catalog.data?.pages.flatMap(p => p.skills) || [];
  // Publishing can briefly remove the current result while ARD rebuilds its index.
  const skill = items.find(s => s.source === selected?.source) || selected;
  return <section className="space-y-4 rounded-lg border p-4" aria-label="Nacos Skill 发现">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-semibold">Nacos Skill 发现</h2>
      <span className="text-sm text-muted-foreground">{catalog.data?.pages[0]?.registry} {catalog.data?.pages[0]?.namespace}</span>
    </div>
    <form className="flex gap-2" onSubmit={e => {
      e.preventDefault();
      if (query === text.trim()) void catalog.refetch();
      else { setSelected(null); setQuery(text.trim()); }
    }}>
      <Input aria-label="ARD 搜索词" placeholder="输入 Skill 名称或能力" value={text} onChange={e => setText(e.target.value)} />
      <Button variant="outline" type="submit">搜索</Button>
      <Button type="button" variant="outline" onClick={() => { void qc.invalidateQueries({ queryKey: ['ard-catalog'] }); void qc.invalidateQueries({ queryKey: ['ard-worker'] }); }}>刷新版本</Button>
    </form>
    {catalog.isPending && <p role="status">正在读取目录…</p>}
    {catalog.error && <p role="alert">{errorText(catalog.error)}</p>}
    <div className="flex flex-wrap gap-2">{items.map(s =>
      <Button key={s.source} variant={s.source === selected?.source ? 'default' : 'outline'} aria-pressed={s.source === selected?.source}
        onClick={() => setSelected(s)}>{s.name} · {s.version}</Button>)}</div>
    {catalog.hasNextPage && <Button variant="outline" onClick={() => void catalog.fetchNextPage()}>查看更多</Button>}
    {catalog.isSuccess && !items.length && <p>没有可发现的 Skill</p>}
    {skill && <WorkerVersions key={skill.source} skill={skill} />}
  </section>;
}

function WorkerVersions({ skill }: {skill: SkillItem}) {
  const qc = useQueryClient();
  const workersQuery = useWorkers();
  const workers = workersQuery.data || [];
  const [selected, setSelected] = useState<string[]>([]);
  const [editor, setEditor] = useState('');
  const [compare, setCompare] = useState('');
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const queries = useQueries({ queries: workers.map(w => ({
    queryKey: ['ard-worker', skill.source, skill.version, w.name],
    queryFn: () => ard<State>({ source: skill.source, name: skill.name, worker: w.name }), retry: false,
  })) });
  const canEdit = (i: number) => {
    const query = queries[i], s = query?.data;
    return !!s && !query.error && !s.runtimeError && !s.incomplete && s.workspace === skill.version &&
      (!s.conflict || (s.bound && s.conflict === '工作区已修改'));
  };
  async function update() {
    setBusy(true);
    try {
      for (const worker of selected) {
        const state = queries[workers.findIndex(w => w.name === worker)]?.data;
        if (!state || state.conflict || state.runtimeError) continue;
        const note = (text: string) => setNotes(n => ({ ...n, [worker]: text }));
        note('正在分发…');
        try {
          await ard({}, { action: 'apply', worker, name: skill.name, source: skill.source, expected: skill.version, digest: state.digest });
          note('已分发，等待运行时确认…');
          const deadline = Date.now() + 120000;
          let confirmed = false;
          do {
            const read = await queries[workers.findIndex(w => w.name === worker)].refetch();
            if (!read.error && read.data?.observed?.enabled && read.data.observed.version === skill.version) { confirmed = true; break; }
            await new Promise(resolve => setTimeout(resolve, 2500));
          } while (Date.now() < deadline);
          note(confirmed ? '运行时已确认' : '已分发，运行时尚未确认，请刷新');
        } catch (e) { note(errorText(e)); }
      }
    } finally { setSelected([]); setBusy(false); }
  }
  return <div className="space-y-3 border-t pt-4">
    <h3 className="font-medium">{skill.name} <span className="ml-2 text-sm text-muted-foreground">上游 {skill.version}</span></h3>
    {workersQuery.error && <p role="alert">{errorText(workersQuery.error)}</p>}
    {workersQuery.isSuccess && !workers.length && <p>没有可访问的 Worker</p>}
    <div className="overflow-x-auto"><table className="w-full text-left text-sm">
      <thead><tr>{['更新对象', '实际启用版本', '工作区版本', '状态', '操作'].map(t => <th className="p-2" key={t}>{t}</th>)}</tr></thead>
      <tbody>{workers.map((w, i) => {
        const q = queries[i], s = q.data, observed = s?.observed;
        const current = !!observed?.enabled && observed.version === skill.version;
        const unavailable = !!q.error || !!s?.runtimeError;
        return <tr key={w.name} className="border-t">
          <td className="p-2"><label className="flex items-center gap-2"><input type="checkbox" checked={selected.includes(w.name)}
            disabled={busy || !s || unavailable || !!s.conflict || (current && s.bound && s.workspace === skill.version && !s.incomplete)}
            onChange={e => setSelected(prev => e.target.checked ? [...prev, w.name] : prev.filter(n => n !== w.name))} />{w.name}</label></td>
          <td className="p-2">{unavailable ? '未知' : observed?.enabled ? observed.version || '版本未知' : observed?.installed ? '未启用' : s ? '未安装' : '读取中…'}</td>
          <td className="p-2">{s?.workspace || '—'}</td>
          <td className="p-2">{q.error ? errorText(q.error) : s?.runtimeError || s?.conflict || (s?.incomplete ? '更新未完成' : !s ? '检测中' : current ? s.bound ? '已是上游版本' : '版本相同，可关联来源' : observed?.installed ? '有可用更新' : '可接入')}
            {notes[w.name] && <p role="status" className="text-xs text-muted-foreground">{notes[w.name]}</p>}</td>
          <td className="p-2"><Button variant="ghost" size="sm" disabled={!s || busy} onClick={() => setCompare(compare === w.name ? '' : w.name)}>查看差异</Button>
            <Button variant="ghost" size="sm" disabled={!s || busy} onClick={() => setEditor(w.name)}>{canEdit(i) ? '编辑并发布' : '查看发布记录'}</Button></td>
        </tr>;
      })}</tbody>
    </table></div>
    <Button disabled={!selected.length || busy} onClick={() => void update()}>更新所选 Agent{selected.length ? '（' + selected.length + '）' : ''}</Button>
    {compare && <SkillDiff key={compare + skill.version} skill={skill} worker={compare} digest={queries[workers.findIndex(w => w.name === compare)]?.data?.digest || ''} />}
    {editor && <SkillEditor key={editor} name={skill.name} skill={skill} worker={editor} close={() => setEditor('')}
      canEdit={canEdit(workers.findIndex(w => w.name === editor))}
      refresh={() => { void qc.invalidateQueries({ queryKey: ['ard-catalog'] }); }} />}
  </div>;
}

type Preview = { size: number; text: string | null; sha256?: string } | null;
function SkillDiff({ skill, worker, digest }: { skill: SkillItem; worker: string; digest: string }) {
  const [file, setFile] = useState('');
  const params = { diff: '1', name: skill.name, source: skill.source, expected: skill.version, worker, digest };
  const changes = useQuery({ queryKey: ['ard-diff', params], enabled: !!digest, retry: false,
    queryFn: () => ard<{changes: {path: string; change: 'added' | 'modified' | 'removed'}[] }>(params) });
  const paths = changes.data?.changes || [];
  const current = paths.some(p => p.path === file) ? file : paths[0]?.path;
  const detail = useQuery({ queryKey: ['ard-diff', params, current], enabled: !!current, retry: false,
    queryFn: () => ard<{ before: Preview; after: Preview }>({ ...params, file: current! }) });
  return <section className="space-y-2 rounded border p-3" aria-label="更新前差异">
    <h4>{worker} 工作区与上游 {skill.version} 的差异</h4>
    {changes.isSuccess && !paths.length && <p>文件内容一致</p>}
    {(changes.error || detail.error) && <p role="alert">{errorText(changes.error || detail.error)}</p>}
    {!!paths.length && <label>变更文件 <select value={current} onChange={e => setFile(e.target.value)}>
      {paths.map(p => <option key={p.path} value={p.path}>{{ added: '新增', removed: '删除', modified: '修改' }[p.change]} · {p.path}</option>)}</select></label>}
    {detail.data && <div className="grid gap-2 sm:grid-cols-2">{(['before', 'after'] as const).map(side => {
      const preview = detail.data[side];
      return <div key={side} className="min-w-0 rounded border p-2"><strong>{side === 'before' ? '工作区内容' : '上游内容'}</strong>
        <pre className="max-h-64 overflow-auto text-xs">{!preview ? '文件不存在' : preview.text ?? ('二进制或大文件 · ' + preview.size + ' 字节\nSHA-256 ' + preview.sha256)}</pre></div>;
    })}</div>}
  </section>;
}

interface Receipt { version: string; base: string; status: string; message: string; source: string; latest: string; upstream: string; discovered: boolean }
const stageNames: Record<string, string> = {
  missing: '尚未创建草稿', draft: '已创建草稿', reviewing: '已提交，等待审核', reviewed: '已通过审核', online: '已上线', rejected: '审核未通过',
};

export function SkillEditor({ name, skill, worker, close, refresh, canEdit = true }: {
  name: string; skill?: SkillItem; worker?: string; close: () => void; refresh: () => void; canEdit?: boolean;
}) {
  const [baseline, setBaseline] = useState(skill);
  const [file, setFile] = useState('SKILL.md');
  const [edits, setEdits] = useState<Record<string, string>>({});
  const [originalDigest, setOriginalDigest] = useState('');
  const [version, setVersion] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [next, setNext] = useState(false);
  const qc = useQueryClient();
  const scope: Record<string, string> = worker ? { name, worker, source: baseline!.source } : { name, local: '1' };
  const receipt = useQuery({ queryKey: ['ard-publication', scope], retry: false, refetchOnMount: 'always',
    queryFn: () => ard<{ registry: string; receipt: Receipt | null }>({ ...scope, receipt: '1' }),
    refetchInterval: q => {
      const r = q.state.data?.receipt;
      return r?.status === 'online' && !r.discovered && (!r.upstream || r.upstream === r.base) && q.state.dataUpdateCount < 30 ? 2000 : false;
    } });
  const rec = receipt.data?.receipt;
  const nextBase = worker ? skill?.version : rec?.version;
  const canStartNext = rec?.status === 'online' && canEdit && rec.latest === nextBase && rec.upstream === nextBase
    && (!worker || rec.source === skill?.source);
  useEffect(() => {
    if (rec?.discovered) void qc.invalidateQueries({ queryKey: ['ard-catalog'] });
  }, [qc, rec?.discovered, rec?.version]);
  const composing = canEdit && (!rec || rec.status === 'missing' || (rec.status === 'online' && next));
  const draft = useQuery({ queryKey: ['ard-edit', scope, baseline?.version, file], enabled: composing && receipt.isSuccess,
    queryFn: () => ard<Draft>({ ...scope, edit: '1', file }), retry: false, refetchOnWindowFocus: false });
  const data = draft.data;
  async function submit(create: boolean) {
    setBusy(true); setError('');
    try {
      await ard({}, { action: create ? 'publish' : 'finish', worker, local: !worker, name, source: baseline?.source || '',
        expected: baseline?.version ?? (rec?.status === 'online' ? rec.version : rec?.base || ''),
        registry: receipt.data?.registry, version: create ? version : rec?.version,
        digest: originalDigest || data?.digest, message, edits });
      setNext(false);
      refresh();
    } catch (e) { setError(errorText(e)); }
    finally { await receipt.refetch(); setBusy(false); }
  }
  return <section className="space-y-3 rounded-md border p-4" aria-label="发布 Skill">
    <h4 className="font-medium">{worker ? worker + ' 的工作区' : '技能中心'} · {name}</h4>
    {(error || receipt.error || draft.error) && <p role="alert">{error || errorText(receipt.error || draft.error)}</p>}
    {rec && <div><p role="status">{rec.version} · {stageNames[rec.status] || rec.status}
      {rec.status === 'online' && (rec.discovered ? ' · ARD 已发现' : rec.upstream ? ' · 当前上游 ' + rec.upstream : ' · 等待 ARD 索引')}</p>
      <p className="text-sm">{rec.message}</p>{rec.source && <p className="break-all text-xs text-muted-foreground">已关联来源 {rec.source}</p>}</div>}
    {composing && data && <>
      <label className="grid gap-1 text-sm">包内文件<select className="rounded border bg-background p-2" value={file} onChange={e => setFile(e.target.value)}>
        {data.paths.map(p => <option key={p}>{p}</option>)}</select></label>
      {data.text === null ? <p>此文件将按原始字节打包</p> : <textarea aria-label="文件内容" rows={8}
        className="w-full rounded border bg-background p-2 font-mono text-sm" disabled={busy} value={edits[file] ?? data.text}
        onChange={e => { setOriginalDigest(prev => prev || data.digest); setEdits(prev => ({ ...prev, [file]: e.target.value })); }} />}
      <div className="grid gap-2 sm:grid-cols-2"><Input aria-label="新版本号" placeholder="新版本号" value={version} disabled={busy} onChange={e => setVersion(e.target.value)} />
        <Input aria-label="变更说明" placeholder="变更说明" value={message} disabled={busy} onChange={e => setMessage(e.target.value)} /></div>
    </>}
    {!canEdit && receipt.isSuccess && !rec && <p>此工作区没有发布记录</p>}
    <div className="flex flex-wrap gap-2">
      {composing && <Button disabled={busy || !data || !version || !message.trim() || !receipt.isSuccess} onClick={() => void submit(true)}>创建草稿</Button>}
      {rec && ['draft', 'reviewed'].includes(rec.status) && <Button disabled={busy} onClick={() => void submit(false)}>
        {rec.status === 'draft' ? '提交发布' : '完成发布'}</Button>}
      {canStartNext && !next && <Button variant="outline" onClick={() => {
        setBaseline(skill); setNext(true); setVersion(''); setMessage(''); setOriginalDigest(''); setEdits({}); void draft.refetch();
      }}>发布下一版本</Button>}
      {rec && <Button variant="outline" disabled={busy} onClick={() => { void receipt.refetch(); refresh(); }}>刷新发布状态</Button>}
      <Button variant="outline" disabled={busy} onClick={close}>关闭编辑</Button></div>
  </section>;
}
