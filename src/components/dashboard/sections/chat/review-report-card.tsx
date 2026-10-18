'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, ChevronDown, ChevronRight, Send, Zap } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  type ReviewVerdict,
  type RuntimeReviewIssue,
  type RuntimeReviewReportBlock,
} from '@/lib/a2ui/protocol';
import {
  fetchRoomState,
  parseReleaseRecords,
  parseSpaceConfig,
  sendReleaseRecord,
  sendSpaceConfig,
} from '@/lib/release-record';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { useRoomMetaStore } from '@/hooks/use-matrix';

const VERDICT_META: Record<ReviewVerdict, { label: string; className: string }> = {
  pass: { label: '审查通过', className: 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  revision_needed: { label: '需修订', className: 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400' },
  blocked: { label: '阻塞', className: 'border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-400' },
};

const SEVERITY_LABELS: Record<RuntimeReviewIssue['severity'], string> = {
  blocker: '阻断',
  suggestion: '建议',
};

const SEVERITY_STYLES: Record<RuntimeReviewIssue['severity'], string> = {
  blocker: 'border-red-500/40 bg-red-500/15 text-red-700 dark:text-red-400',
  suggestion: 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-400',
};

interface ReviewReportCardProps {
  payload: RuntimeReviewReportBlock['payload'];
  /** 原报告事件 id（修复派单消息引用）。 */
  eventId?: string;
  /** 派单/放行说明等以消息发回房间的降级通道。 */
  onSend?: (_text: string) => void;
}

/**
 * 结构化审查报告卡（PRD F3.1/F3.2/F3.4）。
 *
 * - 报告：verdict + 轮次徽标 + 问题列表（分级/位置/复现/责任节点），
 *   一键折叠为摘要；问题项单条勾选。
 * - 修复派单（F3.2，G2 降级）：勾选问题项生成结构化指令消息发回房间
 *   （任务创建依赖上游契约，派单先以消息形态由 Manager 消费），标注轮次。
 * - 放行（F3.3）：verdict=pass 时放行动作写入房间状态事件
 *   （com.agentteams.release）并落审计，联动工件卡三态。
 * - 自动放行（F3.4）：管理员按空间显式开启（默认关）；pass + 开启时提示
 *   放行入口（同一轮次幂等）。
 */
export function ReviewReportCard({ payload, eventId, onSend }: ReviewReportCardProps) {
  // 报告卡所在房间 = 当前活跃房间（聊天面板内渲染；线程面板同房间）。
  const roomId = useRoomMetaStore((s) => s.activeRoomId) ?? undefined;
  const userLevel = useAgentTeamsStore((s) => s.userLevel);
  const currentUserId = useMatrixStore((s) => s.userId);
  const queryClient = useQueryClient();
  const [expanded, setExpanded] = useState(true);
  const [checked, setChecked] = useState<Set<string>>(new Set());

  const verdict = VERDICT_META[payload.verdict];
  const blockers = payload.issues.filter((i) => i.severity === 'blocker');
  const suggestions = payload.issues.filter((i) => i.severity === 'suggestion');

  // 放行历史 + 空间配置（同一 state 查询，15s 口径）。
  const stateQuery = useQuery({
    queryKey: ['room-release-state', roomId],
    queryFn: () => fetchRoomState(roomId!),
    enabled: Boolean(roomId),
    refetchInterval: 15000,
    staleTime: 5000,
    retry: false,
  });
  const releaseRecords = roomId ? parseReleaseRecords(stateQuery.data) : [];
  const spaceConfig = roomId ? parseSpaceConfig(stateQuery.data) : null;
  const autoRelease = spaceConfig?.auto_release === true;
  const releasedThisRound = releaseRecords.some(
    (r) => r.action === 'release' && r.round === payload.round
  );

  const writeState = useMutation({
    mutationFn: async (action: 'release' | 'revoke' | 'toggle-auto') => {
      if (!roomId) throw new Error('no room');
      if (action === 'toggle-auto') {
        await sendSpaceConfig(roomId, { auto_release: !autoRelease, updated_by: currentUserId ?? 'unknown' });
      } else {
        await sendReleaseRecord(roomId, {
          action,
          ...(payload.project_id ? { project_id: payload.project_id } : {}),
          round: payload.round,
          actor: currentUserId ?? 'unknown',
        });
      }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['room-release-state', roomId] });
    },
  });

  const toggleIssue = (id: string) => {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const dispatchFix = () => {
    const picked = payload.issues.filter((i) => checked.has(i.id));
    if (picked.length === 0 || !onSend) return;
    const lines = picked.map((issue, i) => {
      const parts = [
        `${i + 1}. [${SEVERITY_LABELS[issue.severity]}] ${issue.anchor ?? issue.id}`,
        issue.repro ? `   复现：${issue.repro}` : null,
        issue.owner_node ? `   责任节点：${issue.owner_node}` : null,
      ].filter(Boolean);
      return (parts as string[]).join('\n');
    });
    const text = [
      `【修复派单 · 第 ${payload.round} 轮】`,
      `请处理以下 ${picked.length} 个审查问题${eventId ? `（原报告事件 ${eventId}）` : ''}：`,
      '',
      ...lines,
    ].join('\n');
    onSend(text);
  };

  const autoReleaseHint = useMemo(
    () => autoRelease && payload.verdict === 'pass' && !releasedThisRound,
    [autoRelease, payload.verdict, releasedThisRound]
  );

  return (
    <Card className="my-2 w-[min(100%,56rem)] max-w-full border-l-4 border-l-sky-500 py-4">
      <CardHeader className="gap-2 px-4 py-0">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm">
            <ClipboardCheck className="h-4 w-4 text-sky-600 dark:text-sky-400" aria-hidden="true" />
            {payload.title || '审查报告'}
            <Badge variant="outline" className="text-[10px]">
              第 {payload.round} 轮
            </Badge>
          </CardTitle>
          <div className="flex items-center gap-1.5">
            <Badge variant="outline" className={`text-[10px] ${verdict.className}`}>
              {verdict.label}
            </Badge>
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="text-muted-foreground hover:text-foreground transition-colors"
              title={expanded ? '折叠为摘要' : '展开全部问题'}
              aria-expanded={expanded}
            >
              {expanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
        {/* 摘要行（折叠态可见） */}
        <p className="text-[10px] text-muted-foreground">
          {blockers.length} 阻断 · {suggestions.length} 建议
          {payload.summary ? ` · ${payload.summary}` : ''}
        </p>
      </CardHeader>

      {expanded && (
        <CardContent className="space-y-2 px-4 pt-3">
          {payload.issues.map((issue) => {
            const checkedIssue = checked.has(issue.id);
            return (
              <label
                key={issue.id}
                className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-xs transition-colors ${
                  checkedIssue ? 'border-sky-500/60 bg-sky-500/10' : 'border-border/60 hover:bg-accent/50'
                }`}
              >
                <input
                  type="checkbox"
                  checked={checkedIssue}
                  onChange={() => toggleIssue(issue.id)}
                  className="mt-0.5 h-3.5 w-3.5 shrink-0 accent-sky-600"
                  aria-label={`勾选问题 ${issue.anchor ?? issue.id}`}
                />
                <span className="min-w-0 flex-1 space-y-0.5">
                  <span className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant="outline" className={`text-[10px] shrink-0 ${SEVERITY_STYLES[issue.severity]}`}>
                      {SEVERITY_LABELS[issue.severity]}
                    </Badge>
                    <span className="font-medium">{issue.anchor ?? issue.id}</span>
                  </span>
                  {issue.repro && (
                    <span className="block text-[10px] text-muted-foreground">复现：{issue.repro}</span>
                  )}
                  {issue.owner_node && (
                    <span className="block text-[10px] text-muted-foreground">
                      责任节点：<span className="font-mono">{issue.owner_node}</span>
                    </span>
                  )}
                </span>
              </label>
            );
          })}

          <div className="flex items-center gap-2 pt-1 flex-wrap">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-1 px-3 text-xs"
              onClick={dispatchFix}
              disabled={checked.size === 0 || !onSend}
              title="勾选问题项生成修复派单消息（由 Manager 消费）"
            >
              <Send className="h-3 w-3" aria-hidden="true" />
              派发修复{checked.size > 0 ? `（${checked.size}）` : ''}
            </Button>

            {roomId && userLevel >= 2 && (
              releasedThisRound ? (
                <Badge variant="outline" className="text-[10px] border-emerald-500/40 text-emerald-600 dark:text-emerald-400">
                  本轮已放行
                </Badge>
              ) : (
                payload.verdict === 'pass' && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-7 gap-1 px-3 text-xs border-emerald-500/40 text-emerald-600 dark:text-emerald-400"
                    onClick={() => writeState.mutate('release')}
                    disabled={writeState.isPending}
                    title="人工放行（写入房间状态事件并落审计）"
                  >
                    放行
                  </Button>
                )
              )
            )}

            {roomId && userLevel >= 3 && (
              <span className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground">
                <Zap className="h-3 w-3" aria-hidden="true" />
                自动放行
                <Switch
                  checked={autoRelease}
                  onCheckedChange={() => writeState.mutate('toggle-auto')}
                  disabled={writeState.isPending}
                  aria-label="自动放行（按空间，管理员）"
                />
              </span>
            )}
          </div>

          {autoReleaseHint && userLevel >= 2 && (
            <p className="rounded bg-emerald-500/10 px-2 py-1.5 text-[10px] text-emerald-700 dark:text-emerald-400">
              自动放行已开启且本轮审查通过 —— 点击上方「放行」确认（同一轮次幂等，不会重复放行）。
            </p>
          )}
        </CardContent>
      )}
    </Card>
  );
}
