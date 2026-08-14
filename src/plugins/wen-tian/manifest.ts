import type { PluginManifest } from '@/lib/plugins/types';

/**
 * 问天 (WenTian) — runtime diagnostic assistant.
 *
 * A bundled plugin that ships a sidebar entry, a standalone diagnostic page
 * (health snapshot + merged AI log-analysis diagnosis) and an overview widget.
 * The merged "AI 日志分析诊断" flow collects logs server-side (using the
 * on-card collection settings migrated from the Settings dialog), combines
 * them with the user's symptom description and a dashboard snapshot, and
 * streams a structured markdown report back through the AI gateway — the
 * model is selectable (server default or any configured provider model), and
 * no plugin-side LLM credentials are needed.
 */
export const manifest: PluginManifest = {
  id: 'wen-tian',
  name: '问天诊断',
  version: '1.1.0',
  description: '运行时诊断助手：集群健康概览 + AI 日志分析诊断（症状描述 × 实时日志采集 × 可选模型，输出结构化诊断报告），并内置日志收集配置与离线 ZIP 导出。',
  author: 'AgentTeams',
  entry: { dashboard: 'index.tsx' },
  dashboardVersion: '>=0.2.0',
  extensionPoints: ['sidebar-menu', 'route', 'dashboard-widget'],
  permissions: ['network'],
};