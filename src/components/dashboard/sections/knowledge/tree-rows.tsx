'use client';

// 知识库左侧文件树行组件（自 knowledge-section.tsx 拆分，A5 纯重构）。

import { FileText, Folder, FolderOpen, Loader2 } from 'lucide-react';
import type { TreeEntry } from './types';

export function GroupLabel({ text }: { text: string }) {
  return (
    <p className="px-1.5 pt-1.5 pb-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
      {text}
    </p>
  );
}

export function FileRow({ entry, onFile }: { entry: TreeEntry; onFile: (_p: string) => void }) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-xs hover:bg-accent"
      style={{ paddingLeft: '22px' }}
      onClick={() => onFile(entry.path)}
    >
      <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{entry.name}</span>
    </button>
  );
}

/** 顶层目录：只列不展开（插件同款——展开仅限 memory/** 与 digest/**）。 */
export function DirRowReadOnly({ entry }: { entry: TreeEntry }) {
  return (
    <div
      className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-muted-foreground"
      style={{ paddingLeft: '22px' }}
      title="顶层目录只列不展开"
    >
      <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="truncate">{entry.name}/</span>
    </div>
  );
}

export function TreeRow({
  entry,
  depth,
  onFile,
  onDir,
  loading,
  expandedMap,
  setExpanded,
}: {
  entry: TreeEntry;
  depth: number;
  onFile: (_path: string) => void;
  onDir: (_dir: string) => void;
  loading: Record<string, boolean>;
  expandedMap: Record<string, TreeEntry[]>;
  setExpanded: React.Dispatch<React.SetStateAction<Record<string, TreeEntry[]>>>;
}) {
  const entries = expandedMap[entry.path];
  const open = !!entries && entries.length > 0;
  return (
    <div>
      <button
        type="button"
        className="flex w-full items-center gap-1.5 rounded px-1.5 py-0.5 text-xs hover:bg-accent"
        style={{ paddingLeft: `${(depth + 1) * 10}px` }}
        onClick={() => {
          if (entry.kind === 'file') onFile(entry.path);
          else if (!open) onDir(entry.path);
          else setExpanded((m) => ({ ...m, [entry.path]: [] }));
        }}
      >
        {entry.kind === 'directory'
          ? (open ? <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" /> : <Folder className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />)
          : <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />}
        <span className="truncate">{entry.name}</span>
        {entry.kind === 'directory' && loading[entry.path] && (
          <Loader2 className="ml-auto h-3 w-3 shrink-0 animate-spin" aria-hidden="true" />
        )}
      </button>
      {open && (entries ?? []).map((e) => (
        <TreeRow
          key={e.path}
          entry={e}
          depth={depth + 1}
          onFile={onFile}
          onDir={onDir}
          loading={loading}
          expandedMap={expandedMap}
          setExpanded={setExpanded}
        />
      ))}
    </div>
  );
}
