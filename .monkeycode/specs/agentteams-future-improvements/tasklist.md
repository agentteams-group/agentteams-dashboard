# AgentTeams 未来改进实施计划

Feature: agentteams-future-improvements  
Generated: 2026-07-31  

---

## Phase 1: 性能监控指标可视化

### 1. 定义 Metrics 数据类型与 API Schema
- [x] 1.1 在 `src/lib/agentteams-api.ts` 中新增 MetricPoint 和 MetricResponse 接口
  - 定义 timestamp、cpu、memory、networkRx、networkTx 字段
  - 引用 Requirement 2.1-2.2（实时指标、历史趋势查询）
- [x] 1.2 创建 `/src/app/api/agents/[name]/metrics/route.ts` Next.js API Route
  - 接收 start/end/interval query 参数
  - 返回过去 N 分钟的时间序列数据（mock 数据用于开发阶段）
  - 引用 Requirement 2.2（时间范围聚合）
- [x] 1.3 在 `src/hooks/use-agent-metrics.ts` 实现 metric 查询 hook
  - 使用 TanStack Query fetch 最新 metrics
  - 引用 Requirement 2.1（real-time metrics 采集）

### 2. 开发 CPU/Memory 折线图片段组件
- [x] 2.1 创建 `/src/components/dashboard/sections/workers/metric-chart.tsx` 通用折线图组件
  - 使用 Recharts LineChart/Line/XAxis/YAxis 构建
  - 支持双 Y 轴（CPU% 和 Memory Bytes）
  - 引用 Requirement 2.1 正确性属性（每个实体每分钟最多 1 点）
- [x] 2.2 将折线图片段嵌入 Worker 详情对话框（worker-detail-dialog.tsx）
  - 在现有 Tab 区域添加 "资源使用" 标签页
  - 默认展示过去 1 小时 CPU 和 Memory 趋势
  - 引用 Requirement 2.2（历史趋势查询）
- [x] 2.3 添加指标不可用时的降级显示逻辑
  - 当 API 返回空数据时显示 "无可用数据" 占位文案
  - 不抛出错误或崩溃，仅记录 warning 到 console
  - 引用 Requirement 2.1.5（错误处理策略）
- [ ] 2.4 编写 metric-chart.tsx 单元测试（可选）

**Checkpoint**: 确保 Phase 1 所有任务通过类型检查 (npm run typecheck)

### 3. 实现 Overview 全局 KPI 卡片
- [x] 3.1 在 `src/components/dashboard/kpi-card.tsx` 创建可复用 KPI 卡片组件
  - 接受 title、value、subtitle、trend（up/down/stable）props
  - 引用 Requirement 2.3（全局 KPI 摘要）
- [x] 3.2 在 `src/components/dashboard/sections/overview-section.tsx` 添加三个 KPI 卡片
  - Average Health Score（已有）
  - Total CPU Usage (%) — 汇总所有 Worker CPU 均值
  - Total Memory Used (GB) — 汇总所有 Worker memory 使用量
  - 引用 Requirement 2.3（Overview 页面 KPI 摘要）
- [x] 3.3 实现 KPI 数据的缓存与定期刷新逻辑
  - 每 30 秒自动刷新 KPI 数值（不影响主列表自动刷新频率）
  - 引用 Requirement 2.3（实时性要求）
- [ ] 3.4 编写 kpi-card 组件集成测试（可选）

---

## Phase 2: 告警系统集成

### 4. 设计 AlertManager 核心数据结构
- [x] 4.1 在 `src/lib/alert-types.ts` 定义 AlertRule、NotificationPayload 等接口
  - 包含 insightType、severity、channels、recipients、throttleMinutes 字段
  - 引用 Requirement 3.1 和 3.3（规则配置、去重抑制）
- [x] 4.2 创建 `/src/lib/alert-manager.ts` AlertManager 类
  - 方法：register(insight), shouldSend(rule, insight), send(payload, channels)
  - 内存中维护 lastSentTimestamps map 实现节流（throttleMinutes）
  - 引用 Requirement 3.3（相同告警在节流窗口内不重复发送）
- [x] 4.3 实现 Insight → Alert 映射转换函数
  - 将 insights-engine 输出的 Insight 对象转换为 AlertPayload
  - 处理 severity 映射（critical/warning/info → alert 级别）
  - 引用 Requirement 3.2（多渠道通知 payload 格式）

### 5. 实现 Notification Adapters
- [x] 5.1 创建 `src/lib/notifications/base-adapter.ts` 抽象基类
  - 定义 send(payload, config): Promise<void> 接口
  - 引用 Requirement 3.2（多渠道适配器插件化架构）
- [x] 5.2 实现 SlackAdapter（`src/lib/notifications/slack-adapter.ts`）
  - 调用 Slack Incoming Webhook URL
  - 根据 severity 设置 attachment color（danger/warning/good）
  - 引用 Requirement 3.2（Slack 格式规范）
- [x] 5.3 实现 EmailAdapter（`src/lib/notifications/email-adapter.ts`）
  - 调用 SMTP 或直接调用 SendGrid/AWS SES REST API（配置化）
  - 支持多收件人
  - 引用 Requirement 3.2（Email 渠道实现）
- [x] 5.4 复用现有 Matrix 渠道作为通知 adapter
  - 将 matrix-api.ts 的 send 方法封装为 NotificationAdapter
  - 引用 Requirement 3.1（Matrix 作为默认渠道）

### 6. 连接 insights-engine 到 AlertManager
- [x] 6.1 在 `src/hooks/use-insights-alerts.ts` 创建新 hook
  - 订阅 insights-engine 产生的 Insight
  - 当 severity >= 'warning' 时触发 AlertManager.register()
  - 引用 Requirement 3.2（AlertManager 连接数据源）
- [x] 6.2 在 `src/lib/insights-engine.ts` 中添加告警路由逻辑
  - 原有 computeInsights() 保持不变
  - 新增 routeInsightToAlerts(insight) 调用 AlertManager
  - 引用 Requirement 3.2（多渠道同时发送）
- [x] 6.3 添加 AlertManager 失败重试机制（指数退避）
  - 失败时 retry up to 3 times with 1s/2s/4s backoff
  - 记录 failure log 供后续人工排查
  - 引用 Requirement 4.2.6（错误处理）

### 7. 告警规则管理 UI
- [x] 7.1 创建 Settings 子页面 `/settings/alerts` 路由
  - 列出所有 AlertRule，支持新建、编辑、删除
  - 引用 Requirement 3.1（规则 CRUD 界面）
- [x] 7.2 实现 AlertRule 表单组件
  - 下拉选择 insightType（从 insights-engine 常量中获取列表）
  - 多选渠道（Matrix/Slack/Email），必填项校验
  - 输入框填写 webhookUrl 或 email address，正则校验格式
  - 引用 Requirement 3.1（validation 规则）
- [x] 7.3 创建 `/src/app/api/settings/alerts/route.ts` 持久化 API
  - GET: 返回所有规则；POST: 新增；PUT: 更新；DELETE: 删除
  - 使用 localStorage 作为 fallback 存储（后端未就绪时）
  - 引用 Requirement 3.1（配置持久化）
- [x] 7.4 编写告警规则持久化逻辑单元测试（可选）
  - 测试 CRUD 操作的边界情况（empty list、duplicate rule）

**Checkpoint**: 确保告警系统集成后 insights-engine 仍能正常计算洞察（回归测试）

---

## Phase 3: 批量操作编排

### 8. 开发 Batch Operations Hub 页面骨架
- [x] 8.1 创建 `/src/app/(dashboard)/batch-operations/page.tsx` 新路由页面
  - 左侧面板：Workflow 列表（已保存的工作流）
  - 右侧面板：当前选中 Workflow 的步骤编辑器（初始状态）
  - 引用 Requirement 4.1（视觉布局）
- [x] 8.2 在导航菜单中注册 "Batch Operations" 入口
  - 添加到 `src/components/dashboard/nav-items.ts` 的 tools 分组
  - 引用 Requirement 4.1（导航可发现性）

### 9. 实现拖拽式工作流编辑器核心
- [x] 9.1 在 `src/lib/batch-workflow-types.ts` 定义 BatchStep 和 BatchWorkflow 接口
  - step.type: 'select' | 'validate' | 'action' | 'notify'
  - 引用 Requirement 4.1（数据结构设计）
- [x] 9.2 创建步骤节点拖拽组件 `src/components/batch-editor/step-node.tsx`
  - 渲染不同类型步骤的图标和名称（Select/Validate/Wake/Sleep/Delete）
  - 引用 Requirement 4.1（UI 组件）
- [x] 9.3 实现画布区域 `src/components/batch-editor/canvas-wrapper.tsx`
  - 使用原生 HTML5 Drag & Drop 实现拖放节点排序（order 字段更新）
  - 连接线视觉上串联各步骤顺序
  - 引用 Requirement 4.1（drag-and-drop reordering）
- [x] 9.4 创建步骤配置面板 `src/components/batch-editor/step-config-panel.tsx`
  - 点击某步骤时右侧展开配置表单
  - Select 步骤：Worker filter form；Action 步骤：action type dropdown
  - 引用 Requirement 4.2（dry-run 配置来源）

### 10. 实现 Dry-run 预览模式
- [x] 10.1 在 `src/lib/batch-dry-run.ts` 创建 dry-run 模拟执行引擎
  - 对每个步骤调用 mock 函数（不实际 mutate）
  - 返回 predictedAffectedWorkers 和 predictedFailures 列表
  - 引用 Requirement 4.2（dry-run 不修改真实状态）
- [x] 10.2 在工作流编辑器中添加 "Dry Run" 按钮
  - 点击后高亮显示将被影响的 Worker（绿色/红色标记）
  - 在干跑结果面板中显示每个步骤的预期行为
  - 引用 Requirement 4.2（dry-run 结果显示）
- [x] 10.3 实现 Validate 步骤的失败跳过逻辑
  - 如果某 Worker 不满足 validate 条件，dry-run 报告中将其标记为 "Would be skipped"
  - 引用 Requirement 4.2（Validate 失败时终止并提示）

### 11. 实现执行进度跟踪
- [x] 11.1 创建 ExecutionLog 组件 `src/components/batch-execution/execution-log.tsx`
  - 实时显示每个步骤的开始时间、结束时间、状态、受影响 Worker 数量
  - 引用 Requirement 4.3（执行日志可视化）
- [x] 11.2 创建 ProgressProgressBar 组件 `src/components/batch-execution/progress-bar.tsx`
  - 显示当前步骤序号和总步骤数（Step X of Y）+ 颜色进度条
  - 引用 Requirement 4.3（进度条显示）
- [x] 11.3 实现执行中断与错误暂停逻辑
  - 当某步骤失败时暂停执行并标记该步骤为红色
  - 提供 "Continue" / "Abort" 操作按钮
  - 引用 Requirement 4.3（错误处理交互）
- [x] 11.4 存储最近 10 次执行历史（localStorage）
  - 通过 `src/lib/batch-execution-history.ts` 维护历史
  - 在 Workflow 列表中显示最后执行时间和状态
  - 引用 Requirement 4.3（历史记录可追溯）

---

## Phase 4: 新手引导与帮助体系

### 12. 集成首次访问引导流程
- [x] 12.1 安装 react-joyride 包
  - `npm install react-joyride`
  - 引用 Requirement 5.1（首次引导库集成）
- [x] 12.2 创建 OnboardingTour 组件 `src/components/onboarding/tour.tsx`
  - 定义 3-5 个 step：Sidebar Navigation → Search Box → Worker Card → Health Ring
  - 引用 Requirement 5.1（tour steps 描述）
- [x] 12.3 在 DashboardLayout 根组件中初始化引导
  - 检测 localStorage key `agentteams-tour-step` 判断是否已完成
  - 首次访问时自动启动 tour，完成或跳过则写入 finished 标志
  - 引用 Requirement 5.1（localStorage 持久化）
- [x] 12.4 在 Settings 页面添加 "Restart Tour" 按钮
  - 清除 completed 标志，允许用户重新体验
  - 引用 Requirement 5.1（重启引导功能）

### 13. 添加上下文帮助按钮
- [x] 13.1 扩展 SectionHeader 组件添加 HelpButton
  - 在 rightActions 区域渲染 ? 图标按钮（通过 helpContent prop 注入）
  - 引用 Requirement 5.2（每页面帮助入口）
- [x] 13.2 创建 ContextualHelpPopover 组件 `src/components/dashboard/contextual-help-popover.tsx`
  - 弹窗显示：1 sentence purpose + 3 key actions + docs link
  - 内容从配置对象按 sectionId 查找（避免硬编码）
  - 引用 Requirement 5.2（help 内容配置化）
- [x] 13.3 在各 Section 页面（Workers/Teams/Overview/Chat/Batch）注册 help content
  - 通过 getHelpContent() 注入帮助文案，使用 ContextualHelpPopover 渲染
  - 引用 Requirement 5.2（per-section 配置）

### 14. 实现快捷键提示
- [ ] 14.1 在 CommandPalette 组件中添加快捷键指示器
  - 左下角常驻显示 "⌘K / Ctrl+K"
  - 引用 Requirement 5.3（platform-aware 提示）
- [ ] 14.2 创建 KeyboardShortcutsModal 组件
  - 列出所有可用快捷键：Command Palette、Refresh、Search、Toggle Theme
  - 引用 Requirement 5.3（全部快捷键清单）
- [ ] 14.3 支持用户自定义 Command Palette 快捷键
  - 在 Settings → Shortcuts 页面允许重新绑定
  - 引用 Requirement 5.3（customizable shortcuts）

---

## Phase 5: OAuth/SSO 登录支持

### 15. 搭建 OAuth 服务器端回调处理
- [ ] 15.1 创建 `/src/app/api/auth/[provider]/route.ts` Next.js API Route（动态路由）
  - provider: github | google | gitlab
  - 接收 OAuth callback 参数（code、state），发起 token exchange
  - 引用 Requirement 6.1（OAuth callback endpoint）
- [ ] 15.2 实现 GitHub OAuth 适配（`src/lib/oauth/github.ts`）
  - 调用 GitHub API 获取 user info（email、avatar_url）
  - 引用 Requirement 6.1（GitHub provider 实现）
- [ ] 15.3 实现 Google OAuth 适配（`src/lib/oauth/google.ts`）
  - 调用 Google UserInfo API
  - 引用 Requirement 6.1（Google provider 实现）
- [ ] 15.4 实现 Session 创建逻辑
  - 验证成功后设置 httpOnly cookie（或 JWT）
  - 将 OAuth user info 与现有 Matrix user 关联（如 email 匹配）
  - 引用 Requirement 6.2（身份关联）

### 16. 更新 Login Page 添加 OAuth 按钮
- [ ] 16.1 修改 `/src/components/auth/login-page.tsx`
  - 在 Matrix 登录表单下方添加 "Continue with GitHub" 按钮
  - 引用 Requirement 6.1（UI 入口）
- [ ] 16.2 创建 OAuthProviderButton 通用组件
  - 接受 provider id、icon、label props
  - 引用 Requirement 6.1（多 provider 可扩展 UI）
- [ ] 16.3 在 Login Page 顶部添加 OAuth provider 列表（来自 env 配置）
  - NEXT_PUBLIC_OAUTH_PROVIDERS=github,google 环境变量控制显示
  - 引用 Requirement 6.3（security 安全策略）

### 17. 实现安全策略与身份管理
- [ ] 17.1 添加 OAuth callback URL 白名单校验
  - 比对请求中的 state 参数与 session-stored expected state
  - 引用 Requirement 6.3（防止 CSRF）
- [ ] 17.2 实现 Failed OAuth attempts 审计日志
  - 记录 IP、timestamp、provider、failure reason
  - 引用 Requirement 6.3（security audit logging）
- [ ] 17.3 在 User Management 界面显示 auth method
  - Admin 页面可见各用户的 login method（matrix / github / google）
  - 引用 Requirement 6.2（身份管理可见性）
- [ ] 17.4 实现 Disconnect OAuth 账户功能（Profile settings）
  - 允许用户解绑 OAuth，回退到 Matrix password
  - 引用 Requirement 6.2（账户解绑能力）

**Final Checkpoint**: 运行完整测试套件确保所有新功能均通过类型检查和 lint

---

## 跨 Phase 通用任务

### A. 测试基础设施（贯穿各 Phase）
- [ ] A.1 为每个新创建的 lib 模块编写 Property-based tests（可选）
  - 例如：MetricPoint 的 cpu 值始终在 [0, 100]
  - 引用各 Phase 正确性属性
- [ ] A.2 创建 E2E test fixtures（mock worker data、metric data）
  - 引用 Requirements 2.1、3.1 的集成测试需求
- [ ] A.3 在所有测试任务通过后运行 npm run lint -- --fix（可选）

### B. 文档与交付物
- [ ] B.1 更新 `.monkeycode/docs/ARCHITECTURE.md` 添加新子系统说明
  - Metrics Collector、AlertManager、Batch Workflow Engine
  - 引用 ARCHITECTURE.md 现有模板风格
- [ ] B.2 为每个新增 API Route 添加 OpenAPI schema snippet（可选）
  - 放置在对应 route.ts 文件顶部的 JSDoc 注释中
- [ ] B.3 提交所有变更到 git 并生成 release notes（可选）

---

## 优先级与依赖关系说明

```
Phase 1 (Metrics) ──→ Phase 2 (Alerts)
       │                       │
       ↓                       ↓
Phase 4 (Onboarding) ←── Phase 3 (Batch Ops)
                                     │
                                     ↓
                               Phase 5 (OAuth)
```

- **Phase 1** 是 Phase 2 的前提（告警需要 metrics 数据源）
- **Phase 3** 相对独立，可与 Phase 1/2 并行开发
- **Phase 4** 低耦合，可随时插入任何时间点
- **Phase 5** 相对独立，需额外关注安全 review
