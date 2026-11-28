// Runtime metadata: per-runtime icon, badge colors and one-line capability note.
// Shared by the Worker card (feature strip), the RuntimeBadge and the Chat
// corner badges so the same runtime looks identical everywhere.

import type { WorkerRuntime } from '@/lib/agentteams-api';

export interface RuntimeMeta {
  /** Product logo, bundled locally; provenance is in public/runtime-logos/README.md. */
  logo: string;
  /** Standard desired.heartbeat consumption is currently implemented by OpenClaw only. */
  supportsAutonomousHeartbeat?: boolean;
  /** One-line capability note shown in tooltips and the card feature strip. */
  description: string;
}

export const RUNTIME_META: Record<WorkerRuntime, RuntimeMeta> = {
  claudecode: {
    logo: '/runtime-logos/claudecode.svg',
    description: 'Claude Code Harness，支持原生工具、会话与审批',
  },
  codex: {
    logo: '/runtime-logos/codex.svg',
    description: 'Codex Harness，支持 Matrix 任务消息与运行时审批回执',
  },
  openclaw: {
    supportsAutonomousHeartbeat: true,
    logo: '/runtime-logos/openclaw.svg',
    description: '兼容运行时，资源占用较大，不推荐新建',
  },
  copaw: {
    logo: '/runtime-logos/copaw.png',
    description: '已停止新建，请升级到 QwenPaw',
  },
  hermes: {
    logo: '/runtime-logos/hermes.svg',
    description: '原生 chat 适配，依赖上游 streaming',
  },
  openhuman: {
    logo: '/runtime-logos/openhuman.svg',
    description: '基础兜底渲染，通用 Matrix 协议',
  },
  qwenpaw: {
    logo: '/runtime-logos/qwenpaw.svg',
    description: '完整流式协议，思考以 Thinking: 前缀识别',
  },
  'deepseek-harness': {
    logo: '/runtime-logos/deepseek-harness.svg',
    description: '实验性 DeepSeek 工具调用 Harness，思考与工具以结构化流呈现',
  },
};

/** Look up runtime metadata; returns null for unknown / empty runtime strings. */
export function getRuntimeMeta(runtime: string | null | undefined): RuntimeMeta | null {
  if (!runtime) return null;
  return RUNTIME_META[runtime as WorkerRuntime] ?? null;
}
