// Contextual Help Content Configuration
// Each section gets its own help payload; look up by sectionId at render time.

export interface HelpContent {
  /** One-sentence purpose of this section */
  purpose: string;
  /** 3 key actions users can take here */
  keyActions: string[];
  /** Link to relevant docs page (empty string = no link) */
  docsLink?: string;
  docsLabel?: string;
}

export const SECTION_HELP_CONTENT: Record<string, HelpContent> = {
  overview: {
    purpose: '总览页面展示集群的整体健康评分、平均 CPU 使用率和内存使用情况，帮助你快速了解所有 Worker 的运行状态。',
    keyActions: [
      '查看集群健康评分（0–100 分）',
      '查看各 Worker 的 CPU/内存实时指标趋势',
      '通过快捷导航按钮跳转至 Workers 或 Teams 页',
    ],
    docsLink: 'https://docs.agentteams.io/overview',
    docsLabel: '查看文档',
  },
  workers: {
    purpose: 'Workers 页面管理所有 AI Agent 实例，包括生命周期操作、模型绑定和 Matrix 集成配置。',
    keyActions: [
      '批量唤醒/睡眠/删除 Worker',
      '为单个 Worker 配置 AI 模型路由',
      '查看 Worker 详情和实时性能指标',
    ],
    docsLink: 'https://docs.agentteams.io/workers',
    docsLabel: 'Worker 管理指南',
  },
  teams: {
    purpose: 'Teams 页面组织 Worker 分组管理，支持团队拓扑图、Leader 选举和团队内部通信配置。',
    keyActions: [
      '创建新团队并分配 Leader Worker',
      '查看团队拓扑关系和资源分布',
      '调整团队 Worker 数量和权限设置',
    ],
    docsLink: 'https://docs.agentteams.io/teams',
    docsLabel: '团队管理指南',
  },
  chat: {
    purpose: 'Matrix 聊天页面提供与 Agent 的实时对话能力，支持多房间、流式响应和工具调用可见性。',
    keyActions: [
      '在 Team Room 中向特定 Worker 发送指令',
      '查看 AI 思考过程和工具调用日志',
      '管理 Matrix 登录状态和房间列表',
    ],
    docsLink: 'https://docs.agentteams.io/chat',
    docsLabel: '聊天功能说明',
  },
  'batch-operations': {
    purpose: '批量操作页面允许编排多步骤工作流，先干跑验证再执行，适用于大规模 Worker 的批量调度。',
    keyActions: [
      '拖拽编排 Select → Validate → Action → Notify 步骤序列',
      '运行干跑预览受影响和跳过的 Worker 列表',
      '提交执行并实时查看每步进度与结果日志',
    ],
    docsLink: 'https://docs.agentteams.io/batch-ops',
    docsLabel: '批量操作文档',
  },
  managers: {
    purpose: 'Managers 页面管理负责调度和协调 Worker 的 Manager 实例，包括健康监控和故障恢复。',
    keyActions: [
      '查看 Manager 实例健康状态和心跳',
      '手动触发 Manager 故障转移',
      '配置 Manager 调度策略和超时参数',
    ],
  },
  humans: {
    purpose: 'Humans 页面管理团队中的操作人员账号，包括权限分配和访问控制。',
    keyActions: [
      '创建新用户账号并分配角色权限',
      '管理用户的 Matrix ID 绑定关系',
      '查看用户的操作审计日志',
    ],
  },
  docs: {
    purpose: '文档页面聚合项目说明、架构参考和常见问题，是快速了解系统能力的主要入口。',
    keyActions: [
      '浏览系统架构和技术文档',
      '搜索特定功能的实现说明',
      '查看版本更新日志和迁移指南',
    ],
    docsLink: 'https://docs.agentteams.io',
    docsLabel: '完整文档中心',
  },
};

/** Returns help content for a given sectionId, falling back to a generic description. */
export function getHelpContent(sectionId: string): HelpContent {
  return SECTION_HELP_CONTENT[sectionId] ?? {
    purpose: `${sectionId} 页面`,
    keyActions: ['了解更多请参考项目文档'],
  };
}
