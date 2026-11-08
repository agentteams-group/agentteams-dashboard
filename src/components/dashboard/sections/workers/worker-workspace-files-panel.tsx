'use client';

import { useCallback, useEffect, useState } from 'react';
import { AlertCircle, Download, FileText, Folder, Loader2, RefreshCw, Save } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';

interface WorkspaceTreeEntry {
  kind: 'file' | 'directory';
  name: string;
  path: string;
  size?: number | null;
  modified_at?: string;
  preview_kind?: string;
}

interface FileContent {
  content: string;
  etag?: string;
  preview_kind?: string;
}

type ListState = 'loading' | 'ready' | 'unsupported' | 'error';

function isTextKind(kind: string | undefined, name: string): boolean {
  if (kind === 'markdown' || kind === 'text' || kind === 'csv') return true;
  if (kind === 'binary' || kind === 'image' || kind === 'pdf') return false;
  return /\.(md|markdown|txt|log|json|ya?ml|toml|csv|ts|tsx|js|py|go|sh)$/i.test(name);
}

function formatSize(size: number | null | undefined): string {
  if (size == null) return '';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

/**
 * 工作区文件（知识库）只读浏览 + 文本编辑。
 * 读：Controller Docker 代理（dashboard 既有 workspace-files route，老 Controller 亦可用）。
 * 写：Controller PUT workspace-files/file-content（QwenPaw ≥ 2.1；404/403 → 只读降级）。
 */
export function WorkerWorkspaceFilesPanel({ workerName }: { workerName: string }) {
  const [dir, setDir] = useState('');
  const [state, setState] = useState<ListState>('loading');
  const [entries, setEntries] = useState<WorkspaceTreeEntry[]>([]);
  const [listError, setListError] = useState('');
  const [selected, setSelected] = useState<WorkspaceTreeEntry | null>(null);
  const [file, setFile] = useState<FileContent | null>(null);
  const [fileState, setFileState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [fileError, setFileError] = useState('');
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveMessage, setSaveMessage] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null);
  const [editable, setEditable] = useState(true);

  const base = `/api/agentteams/workers/${encodeURIComponent(workerName)}/workspace-files`;

  const loadDir = useCallback(async (path: string) => {
    setState('loading');
    setListError('');
    try {
      const res = await fetch(`${base}/tree?path=${encodeURIComponent(path)}`, { cache: 'no-store' });
      if (res.status === 404 || res.status === 403) {
        setState('unsupported');
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setState('error');
        setListError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as { entries?: WorkspaceTreeEntry[] };
      setEntries(Array.isArray(data.entries) ? data.entries : []);
      setState('ready');
    } catch (err) {
      setState('error');
      setListError(err instanceof Error ? err.message : '网络错误');
    }
  }, [base]);

  useEffect(() => {
    const timer = setTimeout(() => void loadDir(''), 0);
    return () => clearTimeout(timer);
  }, [loadDir]);

  const openFile = useCallback(async (entry: WorkspaceTreeEntry) => {
    setSelected(entry);
    setFile(null);
    setFileState('loading');
    setFileError('');
    setSaveMessage(null);
    setEditable(true);
    try {
      const res = await fetch(`${base}/file-content?path=${encodeURIComponent(entry.path)}`, { cache: 'no-store' });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setFileState('error');
        setFileError(body.error ?? `HTTP ${res.status}`);
        return;
      }
      const data = (await res.json()) as FileContent;
      setFile(data);
      setDraft(data.content ?? '');
      setFileState('idle');
    } catch (err) {
      setFileState('error');
      setFileError(err instanceof Error ? err.message : '读取失败');
    }
  }, [base]);

  const save = useCallback(async () => {
    if (!selected || saving) return;
    setSaving(true);
    setSaveMessage(null);
    try {
      const res = await fetch(`${base}/file-content?path=${encodeURIComponent(selected.path)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ content: draft }),
      });
      if (res.status === 404 || res.status === 403) {
        setEditable(false);
        setSaveMessage({ kind: 'warn', text: '该 Controller 暂不支持在线编辑工作区文件，可下载后离线修改。' });
        return;
      }
      if (res.status === 409) {
        setSaveMessage({ kind: 'err', text: '文件在编辑期间被修改（ETag 冲突），请重新载入后再保存。' });
        return;
      }
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string; message?: string };
        setSaveMessage({ kind: 'err', text: body.error ?? body.message ?? `保存失败（HTTP ${res.status}）` });
        return;
      }
      const data = (await res.json().catch(() => null)) as { etag?: string } | null;
      setFile((prev) => ({ content: draft, etag: data?.etag ?? prev?.etag, preview_kind: prev?.preview_kind }));
      setSaveMessage({ kind: 'ok', text: '已保存' });
    } catch (err) {
      setSaveMessage({ kind: 'err', text: err instanceof Error ? err.message : '保存失败' });
    } finally {
      setSaving(false);
    }
  }, [base, draft, saving, selected]);

  if (state === 'unsupported') {
    return (
      <p className="rounded-lg border border-dashed p-2.5 text-xs text-muted-foreground">
        该 Worker 暂不支持工作区文件（Controller 未开放端点或无权限）。
      </p>
    );
  }

  if (state === 'loading') {
    return (
      <div className="flex items-center gap-2 p-2.5 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
        工作区文件加载中…
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-xs text-amber-700 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
        <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="flex-1">工作区文件加载失败：{listError}</span>
        <Button variant="ghost" size="sm" className="h-6 px-2 text-xs" onClick={() => void loadDir(dir)}>
          <RefreshCw className="mr-1 h-3 w-3" aria-hidden="true" />
          重试
        </Button>
      </div>
    );
  }

  const textFile = selected ? isTextKind(selected.preview_kind, selected.name) : false;

  return (
    <div className="space-y-2 text-xs">
      <div className="flex items-center gap-1 text-muted-foreground">
        <button type="button" className="hover:underline" onClick={() => { setDir(''); setSelected(null); void loadDir(''); }}>
          工作区
        </button>
        {dir && <span>/ {dir}</span>}
      </div>

      {entries.length === 0 ? (
        <p className="text-muted-foreground">工作区为空。</p>
      ) : (
        <ul className="space-y-0.5">
          {entries.map((entry) => {
            const expandable = entry.kind === 'directory' && (entry.name === 'memory' || entry.name === 'digest');
            const isActive = selected?.path === entry.path;
            return (
              <li key={entry.path}>
                <button
                  type="button"
                  className={`flex w-full items-center gap-1.5 rounded px-1 py-0.5 text-left hover:bg-muted ${isActive ? 'bg-muted' : ''} ${entry.kind === 'directory' && !expandable ? 'text-muted-foreground' : ''}`}
                  onClick={() => {
                    if (entry.kind === 'directory') {
                      if (!expandable) return;
                      setDir(entry.path);
                      setSelected(null);
                      void loadDir(entry.path);
                      return;
                    }
                    void openFile(entry);
                  }}
                  disabled={entry.kind === 'directory' && !expandable}
                  title={entry.kind === 'directory' && !expandable ? '仅 memory/ 与 digest/ 支持展开' : undefined}
                >
                  {entry.kind === 'directory' ? (
                    <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  ) : (
                    <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  )}
                  <span className="truncate">{entry.name}</span>
                  {entry.size != null && <span className="ml-auto shrink-0 text-muted-foreground">{formatSize(entry.size)}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {selected && (
        <div className="space-y-2 rounded-lg border p-2">
          <div className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 flex-1 truncate font-mono">{selected.path}</span>
            <a
              className="inline-flex items-center gap-1 text-xs underline underline-offset-2"
              href={`${base}/file-content?path=${encodeURIComponent(selected.path)}&raw=1`}
            >
              <Download className="h-3 w-3" aria-hidden="true" />
              下载
            </a>
          </div>
          {fileState === 'loading' && (
            <div className="flex items-center gap-2 text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
              读取中…
            </div>
          )}
          {fileState === 'error' && (
            <p className="text-destructive">读取失败：{fileError}</p>
          )}
          {file && (
            textFile ? (
              <>
                <Textarea
                  aria-label={`编辑 ${selected.path}`}
                  value={draft}
                  onChange={(event) => { setDraft(event.target.value); setSaveMessage(null); }}
                  className="min-h-40 font-mono text-xs"
                  readOnly={!editable}
                />
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" className="h-7 text-xs" onClick={() => void save()} disabled={saving || !editable || draft === file.content}>
                    {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
                    保存
                  </Button>
                  <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDraft(file.content)} disabled={saving || draft === file.content}>
                    还原
                  </Button>
                  {saveMessage && (
                    <span
                      role={saveMessage.kind === 'err' ? 'alert' : undefined}
                      className={saveMessage.kind === 'ok' ? 'text-emerald-600' : saveMessage.kind === 'warn' ? 'text-amber-600' : 'text-destructive'}
                    >
                      {saveMessage.text}
                    </span>
                  )}
                </div>
              </>
            ) : (
              <p className="text-muted-foreground">二进制/不可预览文件仅支持下载。</p>
            )
          )}
        </div>
      )}
    </div>
  );
}
