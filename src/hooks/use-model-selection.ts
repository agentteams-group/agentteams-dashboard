'use client';

// Model selection single source of truth (same-source single-implementation
// rule): providers + routes → buildModelSelectionOptions, plus an explicit
// "alias group unavailable" signal.
//
// Why the signal exists (F9②/F10, dashboard alias issue): the Higress
// Console session (_hi_sess) is validated server-side per request. When it is
// missing/expired, both queries below fail (401 "A valid Higress Console
// session is required" / 503 configuration error) and `data` is undefined —
// the old call sites fell back to `?? []` and rendered a builtins-only
// selector with no explanation (the user-visible "only the 16 built-in
// aliases" symptom). Consumers must surface the reason + the way out instead
// of silently degrading.
import { useMemo } from 'react';
import { useModels, useAiRoutes, useSglangModels } from '@/hooks/use-agentteams-models';
import {
  buildModelSelectionOptions,
  type ModelSelectionOption,
} from '@/lib/model-catalog';
import type { AiRoute, LlmProviderResponse } from '@/lib/higress-api';

// 401/403 from the Console track mean the admin Console session is missing or
// expired (it is validated per request). Surface that as an actionable login
// hint instead of the raw upstream sentence — a bare 502/401 leaves the user
// with a builtins-only selector and no way out.
const CONSOLE_SESSION_ISSUE = '需要管理员 Console 登录（Higress Console 会话缺失或已失效）';

const SESSION_ERROR_PATTERN =
  /login required|session is required|higress console session|unauthorized|not authenticated|console 登录|会话.*(?:失效|缺失)/i;

function describeSelectionIssue(error: Error): string {
  const message = error.message?.trim() ?? '';
  if (SESSION_ERROR_PATTERN.test(message)) return CONSOLE_SESSION_ISSUE;
  return message || '加载 Higress 模型数据失败';
}

export interface ModelSelection {
  options: ModelSelectionOption[];
  // Raw data for callers that also need binding-level checks
  // (buildModelBindings / hasUnavailableModelAliases submit guards).
  providers: LlmProviderResponse[];
  aiRoutes: AiRoute[];
  isLoading: boolean;
  // Set when the Higress data could not be loaded (console session invalid,
  // console unreachable, or misconfigured). Actionable wording for the UI;
  // null = data loaded (alias group reflects the real gateway state).
  sessionIssue: string | null;
}

export function useModelSelection(): ModelSelection {
  const models = useModels();
  const routes = useAiRoutes();
  const sglang = useSglangModels();
  // Stabilize the fallback arrays (logical expressions create a new ref per
  // render, which would defeat the options memo below).
  const providers = useMemo(() => models.data ?? [], [models.data]);
  const aiRoutes = useMemo(() => routes.data ?? [], [routes.data]);
  const sglangModels = useMemo(() => sglang.data?.models ?? [], [sglang.data]);
  const options = useMemo(
    () => buildModelSelectionOptions(aiRoutes, providers, sglangModels),
    [aiRoutes, providers, sglangModels],
  );
  const error = (models.error ?? routes.error) as Error | null;
  return {
    options,
    providers,
    aiRoutes,
    isLoading: models.isLoading || routes.isLoading,
    sessionIssue: error ? describeSelectionIssue(error) : null,
  };
}
