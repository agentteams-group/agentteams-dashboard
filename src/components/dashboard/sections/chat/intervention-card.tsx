'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HelpCircle, Star, Clock, AlertTriangle, Info, Check } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  type RuntimeConfirmationBlock,
  type RuntimeConfirmationQuestion,
} from '@/lib/a2ui/protocol';
import { useMatrixStore } from '@/lib/matrix-store';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useNotificationStore } from '@/lib/notification-store';
import { useHitlInboxStore } from '@/lib/hitl-inbox';

/** 干预超时默认（PRD F2.2 / Q3：全局 30 分钟，按空间覆盖待上游契约）。 */
export const INTERVENTION_TIMEOUT_MS = 30 * 60 * 1000;

interface InterventionCardProps {
  payload: RuntimeConfirmationBlock['payload'];
  /** 降级回写通道：答案转一条自然语言消息发回房间（上游 v2 answer 契约就绪前）。 */
  onAnswer: (_text: string) => void;
}

interface AnswerState {
  /** 每个问题的选中选项 id（单选一值，多选数组）。 */
  selections: Record<number, string[]>;
  /** 自由输入（与选项互斥）。 */
  freeText: Record<number, string>;
}

/** 块 payload → 问题列表（单问题形态包装为单元素数组）。 */
function questionsFromPayload(payload: RuntimeConfirmationBlock['payload']): RuntimeConfirmationQuestion[] {
  if (payload.questions && payload.questions.length > 0) return payload.questions;
  return [
    {
      question: payload.question ?? payload.tool_name,
      options: payload.options,
      multi_select: payload.multi_select,
    },
  ];
}

/** 初始答案：推荐项（每题至多一个）默认选中（PRD F2.1）。 */
function initialAnswers(questions: RuntimeConfirmationQuestion[]): AnswerState {
  const selections: Record<number, string[]> = {};
  questions.forEach((q, i) => {
    const recommended = q.options?.find((o) => o.recommended);
    if (recommended) selections[i] = [recommended.id];
  });
  return { selections, freeText: {} };
}

function effectiveExpiry(expiresAt: number | undefined): number | undefined {
  if (typeof expiresAt === 'number' && expiresAt > 0) return expiresAt;
  return undefined;
}

/** 把答案集合压成一条自然语言消息（降级回写形态，PRD F2.1 降级路径）。 */
export function composeAnswerText(
  questions: RuntimeConfirmationQuestion[],
  answers: AnswerState
): string {
  const lines = questions.map((q, i) => {
    const picked = (answers.selections[i] ?? [])
      .map((id) => q.options?.find((o) => o.id === id)?.label ?? id)
      .join('、');
    const free = (answers.freeText[i] ?? '').trim();
    const answer = picked || free || '（未作答）';
    return `A${i + 1}：${answer}`;
  });
  return `【干预答复】\n${lines.join('\n')}`;
}

/** 序号快捷键目标：推荐项置顶后的展示顺序（1-9 指向展示序）。 */
function orderedOptions(question: RuntimeConfirmationQuestion) {
  const options = question.options ?? [];
  return [...options].sort((a, b) => Number(b.recommended ?? false) - Number(a.recommended ?? false));
}

/**
 * 选项式干预卡（PRD F2.1，M2 降级路径）。
 *
 * 上游 `org.agentteams.run` v2 answer 契约就绪前，提交动作把答案转成一条
 * 自然语言消息发回房间（复用工具确认的发送通道），并在卡上以能力徽标
 * 常显「未回写运行时状态」（PRD §7.4 降级可见）。
 *
 * 交互规格：推荐项置顶 + 默认选中；序号快捷键 1-9（展示序）；自由输入
 * 与选项互斥；多问题分页逐题作答、末页提交；提交后卡片只读并显示提交人
 * 与时间；超时（expires_at 或默认 30 分钟）置灰禁答并升级通知。
 */
export function InterventionCard({ payload, onAnswer }: InterventionCardProps) {
  const currentUserId = useMatrixStore((s) => s.userId);
  const userLevel = useAgentTeamsStore((s) => s.userLevel);
  const addNotification = useNotificationStore((s) => s.addNotification);

  const questions: RuntimeConfirmationQuestion[] = useMemo(
    () => questionsFromPayload(payload),
    [payload]
  );

  const [answers, setAnswers] = useState<AnswerState>(() => initialAnswers(questions));
  const [page, setPage] = useState(0);
  const [submitted, setSubmitted] = useState<{ by: string; at: number } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  // 挂载时刻（useState 惰性初始化，渲染期只读快照，符合 refs 规范）。
  const [mountedAt] = useState(() => Date.now());
  const expiredNotifiedRef = useRef(false);

  // 超时判定（F2.2）：块级 expires_at 优先，缺省按全局 30 分钟（以卡片
  // 挂载时刻起算，误差可接受且确定性可复现）。
  const expiresAt =
    effectiveExpiry(payload.expires_at) ?? mountedAt + INTERVENTION_TIMEOUT_MS;
  const expired = submitted === null && now >= expiresAt;

  // ── 交互动作（先于引用它们的 effects 声明）──

  // 权限门（PRD F2.1）：带 requested_of 时仅被请求人 / 管理员可提交；
  // 缺省保持现状语义（房间成员均可答复）。
  const requestedOf = payload.requested_of;
  const privileged = userLevel >= 3;
  const forbidden = Boolean(requestedOf) && requestedOf !== currentUserId && !privileged;

  const toggleOption = useCallback((questionIndex: number, optionId: string) => {
    if (submitted || expired || forbidden) return;
    setAnswers((prev) => {
      const multi = questions[questionIndex].multi_select === true;
      const current = prev.selections[questionIndex] ?? [];
      const next = multi
        ? current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId]
        : current.includes(optionId)
          ? []
          : [optionId];
      // 自由输入与选项互斥（PRD F2.1）：选选项即清空该题自由输入。
      return {
        ...prev,
        selections: { ...prev.selections, [questionIndex]: next },
        freeText: next.length > 0 ? { ...prev.freeText, [questionIndex]: '' } : prev.freeText,
      };
    });
  }, [submitted, expired, forbidden, questions]);

  const setFreeText = (questionIndex: number, text: string) => {
    setAnswers((prev) => ({
      ...prev,
      freeText: { ...prev.freeText, [questionIndex]: text },
      // 输入即清空该题选项（互斥）。
      selections: text.trim() ? { ...prev.selections, [questionIndex]: [] } : prev.selections,
    }));
  };

  // 15s 节拍：与全局轮询节奏一致，驱动超时置灰，不引入高频 tick。
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(timer);
  }, []);

  // 超时升级：只发一次通知（管理员视角事件；管理员身份由用户侧判定，
  // 观察者/协作者也会收到可见通知 —— 通知中心按现有优先级展示）。
  useEffect(() => {
    if (!expired || expiredNotifiedRef.current) return;
    expiredNotifiedRef.current = true;
    addNotification({
      type: 'warning',
      title: '干预请求已超时',
      message: `「${questions[page]?.question ?? payload.tool_name}」在 30 分钟内未获答复，任务保持阻塞，请管理员关注。`,
      origin: 'system',
    });
  }, [expired, questions, page, payload.tool_name, addNotification]);

  // 序号快捷键 1-9（自由输入聚焦时让位给文本录入）。
  useEffect(() => {
    if (submitted || expired) return;
    const handler = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) return;
      const index = Number(e.key) - 1;
      const question = questions[page];
      const list = orderedOptions(question);
      if (!question || Number.isNaN(index) || index < 0 || index >= list.length) return;
      e.preventDefault();
      toggleOption(page, list[index].id);
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [submitted, expired, questions, page, toggleOption]);

  if (submitted) {
    return (
      <div className="my-2 rounded-lg border border-l-4 border-l-sky-500 border-sky-500/30 bg-sky-500/5 px-3 py-2 text-xs">
        <div className="flex items-center gap-2 text-sky-600 dark:text-sky-400">
          <Check className="h-3.5 w-3.5" aria-hidden="true" />
          已答复 — {payload.tool_name}
        </div>
        <p className="mt-1 text-[10px] text-muted-foreground">
          提交人 {submitted.by || '我'} · {new Date(submitted.at).toLocaleString('zh-CN', { hour12: false })}
        </p>
      </div>
    );
  }

  const locked = expired;
  const question = questions[page];
  const list = orderedOptions(question);
  const selected = answers.selections[page] ?? [];
  const freeText = (answers.freeText[page] ?? '').trim();
  const canSubmitPage = selected.length > 0 || freeText.length > 0;
  const isLastPage = page === questions.length - 1;

  const submit = () => {
    if (!canSubmitPage || locked || forbidden) return;
    const text = composeAnswerText(questions, answers);
    onAnswer(text);
    setSubmitted({ by: currentUserId ?? '', at: Date.now() });
    // 收件箱互通（F2.3）：任一处处理，另一处同步消失。
    useHitlInboxStore.getState().dropConfirmation(payload.confirmation_id);
  };

  return (
    <div
      className={`my-2 w-[min(100%,56rem)] max-w-full rounded-lg border border-l-4 bg-sky-500/5 overflow-hidden ${
        locked ? 'border-sky-500/20 border-l-muted-foreground/40 opacity-70' : 'border-sky-500/30 border-l-sky-500'
      }`}
    >
      <div className="flex items-center justify-between gap-2 px-3 py-2">
        <span className="flex items-center gap-2 text-xs font-medium text-sky-600 dark:text-sky-400">
          <HelpCircle className="h-3.5 w-3.5" aria-hidden="true" />
          执行中提问 — {payload.tool_name}
        </span>
        <div className="flex items-center gap-1.5">
          {/* 能力徽标（§7.4 降级可见）：v2 结构化回写未接通，答案以消息形态回房间 */}
          <Badge variant="outline" className="text-[10px] gap-1" title="上游 v2 answer 契约未就绪：答复将以一条消息发回房间，本次选择未回写运行时状态">
            <Info className="h-2.5 w-2.5" aria-hidden="true" />
            消息回写
          </Badge>
          {expired && (
            <Badge variant="outline" className="text-[10px] gap-1 border-red-500/40 text-red-600 dark:text-red-400">
              <AlertTriangle className="h-2.5 w-2.5" aria-hidden="true" />
              已超时
            </Badge>
          )}
        </div>
      </div>

      <div className="px-3 pb-3 space-y-2">
        <p className="text-xs leading-relaxed">{question.question}</p>

        <div className="space-y-1" role="radiogroup" aria-label={question.question}>
          {list.map((option, index) => {
            const checked = selected.includes(option.id);
            return (
              <button
                key={option.id}
                type="button"
                role={question.multi_select ? 'checkbox' : 'radio'}
                aria-checked={checked}
                disabled={locked || forbidden}
                onClick={() => toggleOption(page, option.id)}
                className={`w-full flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-left text-xs transition-colors ${
                  checked
                    ? 'border-sky-500/60 bg-sky-500/10'
                    : 'border-border/60 hover:border-sky-500/40 hover:bg-accent/50'
                } ${locked || forbidden ? 'cursor-not-allowed opacity-60' : ''}`}
              >
                <span
                  className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-${
                    question.multi_select ? 'sm' : 'full'
                  } border ${checked ? 'border-sky-500 bg-sky-500 text-white' : 'border-muted-foreground/50'}`}
                  aria-hidden="true"
                >
                  {checked && <Check className="h-2.5 w-2.5" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="font-medium">
                    <span className="mr-1 font-mono text-[10px] text-muted-foreground">{index + 1}.</span>
                    {option.label}
                  </span>
                  {option.description && (
                    <span className="block text-[10px] text-muted-foreground">{option.description}</span>
                  )}
                </span>
                {option.recommended && (
                  <Badge className="shrink-0 border-amber-500/40 bg-amber-500/15 text-[10px] text-amber-700 dark:text-amber-400">
                    <Star className="h-2.5 w-2.5" aria-hidden="true" />
                    推荐
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        <div>
          <label htmlFor={`intervention-free-${payload.confirmation_id}`} className="text-[10px] text-muted-foreground">
            自由输入（与选项互斥）
          </label>
          <textarea
            id={`intervention-free-${payload.confirmation_id}`}
            value={answers.freeText[page] ?? ''}
            disabled={locked || forbidden}
            onChange={(e) => setFreeText(page, e.target.value)}
            rows={2}
            className="mt-1 w-full rounded-md border border-border/60 bg-background/60 px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-sky-500 disabled:opacity-60"
            placeholder="选 None of these？直接输入你的想法…"
          />
        </div>

        {forbidden ? (
          <p className="text-[10px] text-muted-foreground">该提问指定由 {payload.requested_of} 答复（管理员可代答）。</p>
        ) : null}

        {expired && (
          <p className="flex items-center gap-1 text-[10px] text-red-600 dark:text-red-400" role="alert">
            <Clock className="h-3 w-3" aria-hidden="true" />
            超过 30 分钟未答复：卡片已置灰，任务保持 blocked，已升级通知。
          </p>
        )}

        <div className="flex items-center gap-2 pt-1">
          {questions.length > 1 && page > 0 && (
            <Button variant="outline" size="sm" className="h-7 px-3 text-xs" onClick={() => setPage((p) => p - 1)} disabled={locked}>
              上一题
            </Button>
          )}
          {!isLastPage ? (
            <Button
              size="sm"
              className="h-7 px-3 text-xs bg-sky-600 hover:bg-sky-700"
              onClick={() => setPage((p) => p + 1)}
              disabled={locked}
            >
              下一题（{page + 2}/{questions.length}）
            </Button>
          ) : (
            <Button
              size="sm"
              className="h-7 px-3 text-xs bg-sky-600 hover:bg-sky-700"
              onClick={submit}
              disabled={locked || forbidden || !canSubmitPage}
              title={canSubmitPage ? '答案将以一条消息发回房间' : '请先选择选项或输入答复'}
            >
              提交答复
            </Button>
          )}
          {questions.length > 1 && (
            <span className="text-[10px] text-muted-foreground">
              {page + 1} / {questions.length}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
