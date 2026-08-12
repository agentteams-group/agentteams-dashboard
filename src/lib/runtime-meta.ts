// Runtime metadata: per-runtime icon, badge colors and one-line capability note.
// Shared by the Worker card (feature strip), the RuntimeBadge and the Chat
// corner badges so the same runtime looks identical everywhere.

import { Boxes, CircleUser, MessageSquare, PawPrint, Sparkles, type LucideIcon } from 'lucide-react';
import type { WorkerRuntime } from '@/lib/agentteams-api';

export interface RuntimeMeta {
  /** lucide icon for badges and feature strips. */
  icon: LucideIcon;
  /** Tailwind classes for badge-style surfaces (light + dark). */
  badgeClass: string;
  /** One-line capability note shown in tooltips and the card feature strip. */
  description: string;
}

export const RUNTIME_META: Record<WorkerRuntime, RuntimeMeta> = {
  openclaw: {
    icon: PawPrint,
    badgeClass: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
    description: '默认基础运行时，支持 A2UI 协议',
  },
  copaw: {
    icon: Boxes,
    badgeClass: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/30',
    description: 'AgentScope 体系，思考与工具以子消息呈现',
  },
  hermes: {
    icon: MessageSquare,
    badgeClass: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/30',
    description: '原生 chat 适配，依赖上游 streaming',
  },
  openhuman: {
    icon: CircleUser,
    badgeClass: 'bg-gray-500/10 text-gray-600 dark:text-gray-400 border-gray-500/30',
    description: '基础兜底渲染，通用 Matrix 协议',
  },
  qwenpaw: {
    icon: Sparkles,
    badgeClass: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/30',
    description: '完整流式协议，思考以 Thinking: 前缀识别',
  },
};

/** Look up runtime metadata; returns null for unknown / empty runtime strings. */
export function getRuntimeMeta(runtime: string | null | undefined): RuntimeMeta | null {
  if (!runtime) return null;
  return RUNTIME_META[runtime as WorkerRuntime] ?? null;
}
