import type { PluginManifest } from '@/lib/plugins/types';

/**
 * Example plugin manifest (bundled).
 * The same fields work in a standalone plugin.json served over HTTP —
 * see tools/create-dashboard-plugin for the scaffold.
 */
export const manifest: PluginManifest = {
  id: 'monitor-panel',
  name: '监控面板',
  version: '1.0.0',
  description: '示例插件：集群运行状态监控（侧边栏菜单 + 独立页面 + 仪表盘组件）',
  author: 'AgentTeams',
  entry: { dashboard: 'index.tsx' },
  dashboardVersion: '>=0.2.0',
  extensionPoints: ['sidebar-menu', 'route', 'dashboard-widget'],
  permissions: ['network'],
};
