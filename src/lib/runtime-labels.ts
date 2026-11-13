// Runtime / face display names (Chinese dictionary).
//
// The surfaces ship English ids and labels; this table is our own naming
// dictionary for the faces users actually see (same table the workbench plugin
// uses). Unknown faces fall back to the upstream label, then the raw id —
// technical threshold faces intentionally stay in English.

export function runtimeLabel(runtime: string | null | undefined): string {
  switch ((runtime || '').toLowerCase()) {
    case 'codex':
      return 'Codex';
    case 'qwenpaw':
      return 'QwenPaw';
    case 'openclaw':
      return 'OpenClaw';
    case 'hermes':
      return 'Hermes';
    case 'deepseek-harness':
      return 'DeepSeek Harness';
    case 'copaw':
      return 'CoPaw';
    case 'openhuman':
      return 'OpenHuman';
    default:
      return runtime || '未知运行时';
  }
}

const OPENCLAW: Record<string, string> = {
  gateway: '网关',
  models: '模型',
  agents: 'Agent',
  tools: '工具',
  channels: '频道',
  messaging: '消息',
  voice: '语音',
  session: '会话',
  automation: '自动化',
  'skills-plugins': '技能与插件',
  mcp: 'MCP',
  browser: '浏览器',
  security: '安全',
  observability: '可观测',
  ui: '界面',
  workspace: '工作区',
};

const HERMES: Record<string, string> = {
  model: '模型',
  providers: '提供方',
  fallback_providers: '备用提供方',
  fallback: '回退策略',
  credential_pool_strategies: '凭据池策略',
  toolsets: '工具集',
  database: '数据库',
  runtime: '运行时',
  session: '会话',
  sessions: '会话',
  attachments: '附件',
  agent: 'Agent',
  terminal: '终端',
  web: 'Web',
  browser: '浏览器',
  worktrees: '工作树',
  checkpoints: '检查点',
  context: '上下文',
  memory: '记忆',
  compression: '压缩',
  prompt_caching: '提示缓存',
  mcp: 'MCP',
  mcp_servers: 'MCP 服务',
  tool_output: '工具输出',
  tool_loop_guardrails: '工具循环护栏',
  tools: '工具',
  skills: '技能',
  plugins: '插件',
  hooks: '钩子',
  approvals: '审批',
  security: '安全',
  auth: '认证',
  vault: '密钥库',
  secrets: '密钥',
  privacy: '隐私',
  telemetry: '遥测',
  monitoring: '监控',
  logging: '日志',
  network: '网络',
  proxy: '代理',
  gateway: '网关',
  streaming: '流式',
  model_catalog: '模型目录',
  model_overrides: '模型覆盖',
  auxiliary: '辅助模型',
  delegation: '委派',
  goals: '目标',
  loops: '循环',
  timezone: '时区',
  slack: 'Slack',
  discord: 'Discord',
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  matrix: 'Matrix',
  platforms: '平台',
  display: '显示',
  dashboard: '仪表盘',
  voice: '语音',
  tts: '语音合成',
  stt: '语音识别',
  vision: '视觉',
  wake_word: '唤醒词',
  code_execution: '代码执行',
  computer_use: '电脑操作',
  desktop: '桌面',
  local_runtime: '本地运行时',
  updates: '更新',
  doctor: '诊断',
  cron: '定时任务',
};

const BY_RUNTIME: Record<string, Record<string, string>> = {
  openclaw: OPENCLAW,
  hermes: HERMES,
};

export function faceLabel(runtime: string, faceId: string, fallback?: string): string {
  const table = BY_RUNTIME[(runtime || '').toLowerCase()] ?? {};
  return table[faceId] ?? (fallback && fallback.trim() ? fallback : faceId);
}

export function fieldLabel(key: string, fallback?: string): string {
  if (fallback && fallback.trim()) return fallback;
  const tail = key.split('.').pop() ?? key;
  return tail.replace(/[_-]+/g, ' ');
}

export const SUB_SECTION_LABELS: Record<string, string> = {
  reactAgent: 'React Agent',
  agentLoop: 'Agent Loop',
  llmRetry: 'LLM 重试',
  llmRateLimiter: 'LLM 限流',
  context: '上下文',
  memory: '记忆',
  embeddingModel: '嵌入模型',
  toolExecutionLevel: '工具执行级别',
};
