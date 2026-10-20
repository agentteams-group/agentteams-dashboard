'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck, MessageSquareText, Send } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from 'sonner';
import {
  parseArtifactComments,
  resolveCommentThreads,
  sendArtifactComment,
  sendRoomText,
} from '@/lib/artifact-comment';
import { useMatrixStore } from '@/lib/matrix-store';
import { matrixProxyFetch } from '@/lib/matrix-write';

// 注：评论读取走 /messages chunk（含自定义 content key），15s 轮询口径。
async function fetchRoomMessages(roomId: string): Promise<unknown> {
  const res = await matrixProxyFetch(
    `/api/matrix/rooms/${encodeURIComponent(roomId)}/messages?dir=b&limit=200`,
    { method: 'GET' },
  );
  if (!res.ok) throw new Error(`messages failed (${res.status})`);
  return res.json();
}

interface ArtifactCommentPanelProps {
  roomId?: string;
  artifact: string;
  /** 当前锚点行（预览区点击行号时设置）。 */
  anchorLine: number | null;
  /** 任务维度指派目标（F6.3 派单消息 @ 对象，如责任 Agent）。 */
  defaultAssignee?: string;
}

/**
 * 工件锚点评论（PRD F6.2/F6.3）：
 * - 列表（作者/时间/行锚/解决状态）+ 新增（文本工件按行锚点）；
 * - 评论即房间消息（正文进时间线），解决状态以追加事件回溯；
 * - 批量派发（G2 降级）：勾选评论生成结构化修复指令发回房间。
 */
export function ArtifactCommentPanel({ roomId, artifact, anchorLine, defaultAssignee }: ArtifactCommentPanelProps) {
  const queryClient = useQueryClient();
  const currentUserId = useMatrixStore((s) => s.userId) ?? 'unknown';
  const [text, setText] = useState('');
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [assignee, setAssignee] = useState(defaultAssignee ?? '');

  const commentsQuery = useQuery({
    queryKey: ['artifact-comments', roomId],
    queryFn: () => fetchRoomMessages(roomId!),
    enabled: Boolean(roomId),
    refetchInterval: 15000,
    staleTime: 5000,
    retry: false,
  });

  const mine = useMemo(() => {
    const threads = resolveCommentThreads(parseArtifactComments(commentsQuery.data));
    return threads.filter((t) => t.artifact === artifact);
  }, [commentsQuery.data, artifact]);

  const post = async (action: 'comment' | 'resolve', resolvesTs?: number) => {
    if (!roomId) {
      toast.error('当前任务未绑定空间，暂无法评论');
      return;
    }
    try {
      await sendArtifactComment({
        roomId,
        artifact,
        body: action === 'resolve' ? '' : text.trim(),
        author: currentUserId,
        ...(anchorLine !== null ? { line: anchorLine } : {}),
        action,
        resolvesTs,
      });
      if (action === 'comment') setText('');
      await queryClient.invalidateQueries({ queryKey: ['artifact-comments', roomId] });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '评论失败');
    }
  };

  const dispatchSelected = async () => {
    if (!roomId) return;
    const picked = mine.filter((t) => checked.has(t.ts));
    if (picked.length === 0 || !assignee.trim()) {
      toast.error('请勾选评论并填写指派对象');
      return;
    }
    const lines = picked.map(
      (t, i) => `${i + 1}. [${t.line ? `L${t.line}` : '全文'}] ${t.body}（评论人 ${t.author}）`,
    );
    const body = [
      `【修复派单 · 工件评论】@${assignee.trim()}`,
      `请处理工件 ${artifact} 的 ${picked.length} 条评论：`,
      '',
      ...lines,
    ].join('\n');
    try {
      await sendRoomText(roomId, body);
      setChecked(new Set());
      toast.success(`已派发 ${picked.length} 条评论给 @${assignee.trim()}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : '派发失败');
    }
  };

  return (
    <div className="rounded-md border bg-muted/20 p-2.5 space-y-2" data-testid="artifact-comments">
      <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <MessageSquareText className="h-3.5 w-3.5" aria-hidden="true" />
        评论（{mine.length}）
        {!roomId && <span className="text-[10px]">· 未绑定空间，只读</span>}
      </p>

      <div className="space-y-1 max-h-40 overflow-y-auto custom-scrollbar">
        {mine.map((t) => (
          <label key={t.ts} className="flex items-start gap-2 rounded border border-border/50 px-2 py-1 text-[11px]">
            <input
              type="checkbox"
              className="mt-0.5 h-3 w-3 accent-sky-600"
              checked={checked.has(t.ts)}
              onChange={() =>
                setChecked((prev) => {
                  const next = new Set(prev);
                  if (next.has(t.ts)) next.delete(t.ts);
                  else next.add(t.ts);
                  return next;
                })
              }
              aria-label={`勾选评论 ${t.body.slice(0, 12)}`}
            />
            <span className="min-w-0 flex-1">
              <span className="flex items-center gap-1.5 flex-wrap">
                {t.line !== undefined && (
                  <Badge variant="outline" className="text-[9px] px-1">
                    L{t.line}
                  </Badge>
                )}
                <span>{t.body}</span>
              </span>
              <span className="block text-[9px] text-muted-foreground">
                {t.author} · {new Date(t.ts).toLocaleTimeString('zh-CN', { hour12: false })}
                {t.resolvedBy && (
                  <Badge variant="outline" className="ml-1 text-[9px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                    已解决（{t.resolvedBy}）
                  </Badge>
                )}
              </span>
            </span>
            {!t.resolvedBy && roomId && (
              <Button
                variant="ghost"
                size="sm"
                className="h-4 px-1 text-[9px] text-muted-foreground"
                onClick={() => void post('resolve', t.ts)}
                title="标记解决（追加事件，可回溯）"
              >
                <CheckCheck className="h-2.5 w-2.5" aria-hidden="true" />
                解决
              </Button>
            )}
          </label>
        ))}
        {mine.length === 0 && (
          <p className="text-[10px] text-muted-foreground">暂无评论。文本工件可点击行号定位锚点。</p>
        )}
      </div>

      {roomId && (
        <div className="flex items-center gap-1.5">
          <Input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={anchorLine !== null ? `评论 L${anchorLine}…` : '评论整份工件…'}
            className="h-7 flex-1 text-xs"
            aria-label="评论内容"
          />
          <Button
            size="sm"
            className="h-7 px-2.5 text-xs"
            onClick={() => void post('comment')}
            disabled={!text.trim()}
          >
            <Send className="h-3 w-3" aria-hidden="true" />
          </Button>
        </div>
      )}

      {roomId && mine.length > 0 && (
        <div className="flex items-center gap-1.5">
          <Input
            value={assignee}
            onChange={(e) => setAssignee(e.target.value)}
            placeholder="指派给 Agent（名字）"
            className="h-7 w-40 text-xs"
            aria-label="指派对象"
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => void dispatchSelected()}
            disabled={checked.size === 0 || !assignee.trim()}
            title="勾选评论批量派发（结构化指令消息，由 Manager 消费）"
          >
            批量派发（{checked.size}）
          </Button>
        </div>
      )}
    </div>
  );
}
