// Worker loop-mode catalog + custom loop CRUD (QwenPaw loop tab parity).
//
// The controller proxies the qwenpaw loops router under
// `GET  /api/v1/workers/{name}/loops`
// `GET  /api/v1/workers/{name}/loops/custom`
// `POST /api/v1/workers/{name}/loops/custom`            (201; 409 duplicate)
// `PUT  /api/v1/workers/{name}/loops/custom/{mode}`     (whole-object replace)
// `DELETE /api/v1/workers/{name}/loops/custom/{mode}`   (204)
// The dashboard exposes them through narrow Next proxy routes (no surface, no
// member-config).

import { ApiError, NetworkError } from '@/lib/api-error';
import { apiUrl, extractErrorDetail } from '@/lib/api-base';

export interface WorkerLoopModeInfo {
  id: string;
  name: string;
  slash_command?: string;
  description?: string;
  source?: string;
}

export interface WorkerLoopGate {
  id: string;
  type: string;
  enabled?: boolean;
  params?: Record<string, unknown>;
}

export interface WorkerLoopCustomMode {
  id: string;
  name: string;
  description?: string;
  slash_command: string;
  enabled?: boolean;
  gates?: WorkerLoopGate[];
}

const loopsPath = (workerName: string) =>
  apiUrl(`/api/agentteams/workers/${encodeURIComponent(workerName)}/loops`);

const customPath = (workerName: string) =>
  apiUrl(`/api/agentteams/workers/${encodeURIComponent(workerName)}/loops/custom`);

const customModePath = (workerName: string, modeId: string) =>
  apiUrl(
    `/api/agentteams/workers/${encodeURIComponent(workerName)}/loops/custom/${encodeURIComponent(modeId)}`,
  );

async function call<T>(url: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(url, { cache: 'no-store', ...init });
  } catch (err) {
    throw new NetworkError(url, err);
  }
  if (!res.ok) {
    const detail = await extractErrorDetail(res, `HTTP ${res.status}`);
    throw new ApiError(detail, res.status, url);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export async function fetchWorkerLoopModes(workerName: string): Promise<WorkerLoopModeInfo[]> {
  const body = await call<WorkerLoopModeInfo[]>(loopsPath(workerName));
  return Array.isArray(body) ? body : [];
}

export async function fetchWorkerLoopCustoms(workerName: string): Promise<WorkerLoopCustomMode[]> {
  const body = await call<WorkerLoopCustomMode[]>(customPath(workerName));
  return Array.isArray(body) ? body : [];
}

export async function createWorkerLoopCustom(
  workerName: string,
  mode: WorkerLoopCustomMode,
): Promise<WorkerLoopCustomMode> {
  return call<WorkerLoopCustomMode>(customPath(workerName), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(mode),
  });
}

export async function updateWorkerLoopCustom(
  workerName: string,
  mode: WorkerLoopCustomMode,
): Promise<WorkerLoopCustomMode> {
  return call<WorkerLoopCustomMode>(customModePath(workerName, mode.id), {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(mode),
  });
}

export async function deleteWorkerLoopCustom(workerName: string, modeId: string): Promise<void> {
  await call<void>(customModePath(workerName, modeId), { method: 'DELETE' });
}

// ── Loop templates (ported from the workbench plugin runtimeCfg/helpers.ts) ──
// Source of the design: QwenPaw console AgentLoopCard.tsx
// (GATE_DEFINITIONS / TEMPLATES / makeGate / buildCustomLoopMode). Names,
// gate sets and defaults are preserved verbatim.

type LoopGateType =
  | 'iteration'
  | 'doom_loop'
  | 'token_budget'
  | 'timeout'
  | 'tool_call_budget'
  | 'qualitative_rubric'
  | 'completion_rubric';

export const LOOP_TEMPLATES: Record<string, LoopGateType[]> = {
  safe: ['iteration', 'token_budget', 'doom_loop', 'qualitative_rubric'],
  research: ['iteration', 'timeout', 'tool_call_budget', 'doom_loop'],
  quality: ['iteration', 'token_budget', 'doom_loop', 'completion_rubric'],
  blank: [],
};

export const LOOP_TEMPLATE_LABELS: Record<string, string> = {
  safe: '安全运行',
  research: '预算研究',
  quality: '质量优先',
  blank: '空管道',
};

export const LOOP_GATE_DEFS: Record<
  LoopGateType,
  { title: string; desc: string; defaults: Record<string, unknown> }
> = {
  iteration: {
    title: '迭代限制',
    desc: '固定迭代次数后停止。',
    defaults: { max_iterations: 40 },
  },
  doom_loop: {
    title: '重复保护',
    desc: '检测重复工具调用并改变策略。',
    defaults: {
      window_size: 3,
      similarity_threshold: 1,
      stages: [
        {
          after: 3,
          action: 'modify_prompt',
          prompt: 'Change strategy instead of repeating the same action.',
        },
        {
          after: 5,
          action: 'stop',
          prompt: 'Stopped after repeated actions did not make progress.',
        },
      ],
    },
  },
  token_budget: {
    title: '词元预算',
    desc: '限制提示与生成词元用量。',
    defaults: { max_total_tokens: 120000 },
  },
  timeout: {
    title: '循环时限',
    desc: '超过耗时后在下一个循环边界停止。',
    defaults: { max_seconds: 1800 },
  },
  tool_call_budget: {
    title: '工具调用预算',
    desc: '限制全部调用与指定工具。',
    defaults: { max_calls: 30, per_tool: {} },
  },
  qualitative_rubric: {
    title: '定性完成检查',
    desc: '结束前检查无工具调用的文本回复。',
    defaults: {
      rubric: 'Every explicit user requirement must be addressed.',
      max_evaluations: 1,
    },
  },
  completion_rubric: {
    title: '完成信号检查',
    desc: '检查文本回复中的完成信号。',
    defaults: {
      prompt:
        'Treat the task as complete only when every explicit user requirement has been addressed. If any requirement remains, the task is incomplete and work must continue until it is addressed.',
      completion_signal: 'COMPLETED',
      max_evaluations: 3,
    },
  },
};

/** Build a custom loop mode from a template, QwenPaw `buildCustomLoopMode`
 * semantics: template gate order, gate ids = `${type}-${nonce}`, defaults
 * deep-copied so later edits never mutate the table. */
export function buildCustomLoopFromTemplate(options: {
  name: string;
  slashCommand: string;
  description: string;
  template: string;
  enabledGates?: Record<string, boolean>;
}): WorkerLoopCustomMode {
  const nonce = `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const typeList = LOOP_TEMPLATES[options.template] ?? [];
  const gates = typeList
    .filter((type) => options.enabledGates?.[type] !== false)
    .map((type) => ({
      id: `${type}-${nonce}`,
      type,
      enabled: true,
      params: JSON.parse(JSON.stringify(LOOP_GATE_DEFS[type].defaults)) as Record<string, unknown>,
    }));
  return {
    id: options.name,
    name: options.name,
    description: options.description,
    slash_command: options.slashCommand.replace(/^\/+/, ''),
    enabled: true,
    gates,
  };
}
