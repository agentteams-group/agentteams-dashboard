import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { isReplayId, replayDir } from '../../api/agentteams/replay/export/route';
import { parseReplayJsonl } from '@/lib/replay/parse-replay';
import { parseAuditRef } from '@/lib/replay/audit-ref';
import { listAuditEvents, type AuditEventRecord } from '@/lib/audit-log';
import { ReplayTimeline } from './replay-timeline';
import type { MatrixEvent } from '@/lib/matrix-api';

interface ReplayBundle {
  replayId: string;
  createdAt: string;
  room: string;
  exportedBy?: string;
  messages?: number;
  files: Record<string, string | { path: string; content?: string }>;
  auditEvents?: AuditEventRecord[];
}

export default async function ReplayPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<{ eventId?: string }>;
}) {
  const { id } = await params;
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const highlightEventId = resolvedSearchParams.eventId ?? null;

  if (!isReplayId(id)) {
    return (
      <div className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">无效的回放链接。</div>
    );
  }

  let bundle: ReplayBundle;
  try {
    const raw = await fs.readFile(path.join(replayDir(), `${id}.json`), 'utf8');
    bundle = JSON.parse(raw) as ReplayBundle;
  } catch {
    return (
      <div className="mx-auto max-w-3xl p-8 text-sm text-muted-foreground">回放不存在或已被清理。</div>
    );
  }

  // 1. 提取所有 jsonl 文件中的原始事件并按时间戳升序排序
  const allEvents: MatrixEvent[] = [];
  const entries = Object.entries(bundle.files ?? {}).sort(([a], [b]) => a.localeCompare(b));

  for (const [, file] of entries) {
    const content = typeof file === 'string' ? file : file.content ?? '';
    if (content) {
      allEvents.push(...parseReplayJsonl(content));
    }
  }

  allEvents.sort((a, b) => a.origin_server_ts - b.origin_server_ts);

  // 2. 加载或回退读取该房间的 hitl.* / release.* 审计记录（D-2）
  let auditEvents = bundle.auditEvents ?? [];
  if (auditEvents.length === 0) {
    try {
      const all = await listAuditEvents({ limit: 500 });
      auditEvents = all.filter((ev) => {
        const ref = parseAuditRef(ev);
        return ref.roomId === bundle.room || ev.entity_name === bundle.room;
      });
    } catch {
      // 容错读取
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="sticky top-0 z-10 -mx-6 -mt-6 border-b border-border/60 bg-background/95 px-6 py-4 backdrop-blur supports-[backdrop-filter]:bg-background/60">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h1 className="text-base font-semibold tracking-tight">会话回放（只读）</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">
              房间 <span className="font-mono font-medium text-foreground">{bundle.room}</span> · 导出时间{' '}
              {new Date(bundle.createdAt).toLocaleString()} · 共 {allEvents.length} 个原始事件
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-border/80 bg-muted/50 px-2.5 py-0.5 text-xs text-muted-foreground">
              已默认 PII 脱敏
            </span>
            <span className="inline-flex items-center rounded-full bg-status-info/10 border border-status-info/30 px-2.5 py-0.5 text-xs font-medium text-status-info">
              链接即凭据，请勿外传
            </span>
          </div>
        </div>
      </header>

      <main>
        <ReplayTimeline
          events={allEvents}
          auditEvents={auditEvents}
          highlightEventId={highlightEventId}
        />
      </main>
    </div>
  );
}
