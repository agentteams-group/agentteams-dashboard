import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { isReplayId, replayDir } from '../../api/agentteams/replay/export/route';

interface ReplayBlock {
  type: string;
  text?: string;
  content?: string;
  payload?: { tool_name?: string; status?: string };
}

interface ReplayBundle {
  replayId: string;
  createdAt: string;
  room: string;
  blocks?: ReplayBlock[];
  files: Record<string, { path: string; content?: string }>;
}

export default async function ReplayPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isReplayId(id)) {
    return (
      <div className="p-8 text-sm text-muted-foreground">无效的回放链接。</div>
    );
  }

  let bundle: ReplayBundle;
  try {
    const raw = await fs.readFile(path.join(replayDir(), `${id}.json`), 'utf8');
    bundle = JSON.parse(raw) as ReplayBundle;
  } catch {
    return (
      <div className="p-8 text-sm text-muted-foreground">回放不存在或已被清理。</div>
    );
  }

  // debug-log 的 Matrix 导出按 room 聚合消息正文（files 键 = 相对路径）。
  // 回放视图按文件顺序逐条渲染为只读时间线。
  const entries = Object.entries(bundle.files ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold">会话回放（只读）</h1>
        <p className="text-xs text-muted-foreground">
          房间 {bundle.room} · 导出时间 {bundle.createdAt} · 已默认 PII 脱敏 · 链接即凭据，请勿外传
        </p>
      </header>
      {entries.length === 0 && (
        <p className="text-sm text-muted-foreground">该回放包为空。</p>
      )}
      {entries.map(([relPath, file]) => (
        <article key={relPath} className="rounded-lg border border-border/60 bg-card/40 p-3">
          <p className="mb-1 font-mono text-[10px] text-muted-foreground">{relPath}</p>
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] leading-relaxed">
            {file.content ?? ''}
          </pre>
        </article>
      ))}
    </div>
  );
}
