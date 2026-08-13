import type { PluginManifest } from '@/lib/plugins/types';

/**
 * 问天 (WenTian) — runtime diagnostic assistant.
 *
 * A bundled plugin that ships a sidebar entry, a standalone diagnostic page
 * (7 health checks + severity scoring + copyable report) and an overview
 * widget. AI-powered diagnosis piggybacks on the existing Controller
 * `/api/agentteams/troubleshoot` endpoint so it uses the default AI Gateway
 * model — no plugin-side LLM config needed.
 */
export const manifest: PluginManifest = {
  id: 'wen-tian',
  name: '问天诊断',
  version: '1.0.0',
  description: '运行时诊断助手：执行 7 项健康检查、评估严重等级、生成可一键复制的诊断报告（AI 分析走默认模型）。',
  author: 'AgentTeams',
  entry: { dashboard: 'index.tsx' },
  dashboardVersion: '>=0.2.0',
  extensionPoints: ['sidebar-menu', 'route', 'dashboard-widget'],
  permissions: ['network'],
};