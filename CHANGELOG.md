# Changelog

## Unreleased

### New Features

- **项目时间线面板（Project Timeline Panel）**：在项目详情面板底部新增「干预记录」折叠区，调用 Controller `GET /api/v1/projects/{id}/history` 与 `…/history/{ts}` 端点，按时间倒序列出每次人工干预（暂停 / 恢复 / 重规划等）前的 workflow 快照元数据；点击单条记录可查看状态、标题、操作人、操作时间、暂停原因等审计字段
  - 404 走与 worker checkpoint 一致的「Controller 升级后可见」降级文案，不阻塞项目主流程
  - 用 AbortController 取消未完成的请求，避免面板关闭/组件卸载后状态错位
- **Worker 检查点面板（Worker Checkpoint Panel）**：在 Worker 详情 Dialog 新增「检查点」折叠区，调用 Controller `GET /api/v1/workers/{name}/checkpoints/{graph|status}` 端点，展示自动打点状态、统计汇总（自动/快照/安全）以及最近 5 条打点
  - Controller 返回 `502 requires QwenPaw 2.1` 时降级为「该 Worker 需 QwenPaw 2.1 才支持检查点」占位文案，并在 session 内缓存该判定，避免低版本 Worker 反复触发请求
  - status 200 / graph 5xx 的半降级场景下保留自动打点徽标，只隐藏打点列表，遵循 `allSettled` 容错策略
- **项目 API 降级横幅（DegradedBanner）**：在项目页头部展示 Controller 端点 404（API 未部署）/ 500（Controller 故障）的差异化提示，并附带 Controller 返回的原始错误信息，便于运维快速定位

### Contributors

- @monkeycode-ai（平台 AI 协作者）

## v1.2.3.1 (2026-08-18)

### New Features

- **任务看板主数据源切换为 Controller API（D5/D8）**：看板数据优先从 Controller API 拉取，MinIO 作为回退源，提升数据一致性与可用性
- **Chat 空状态插图**：Bot 渐变插图 + 消息角标，替代原单一图标
- **流式打字机效果**：流式输出逐字符展示 + 光标动画；纯文本走轻量渲染路径，块级内容走完整 Markdown 渲染
- **工具卡片结构化升级**：
  - 状态点 + 状态徽标变色（成功绿 / 失败红 / 进行中紫），折叠态直接展示错误首行摘要
  - IN/OUT 输入输出区块徽标
  - streaming / thinking 卡片统一圆角与悬停阴影
  - workflow 步骤字形三态：完成勾 / 失败叉 / 进行中转圈 / 待执行虚线环

### Bug Fixes

- 修复流式追加时打字机头部重置（每追加一个字符就从头部重新打字）
- 修复 workflow 待执行步骤误显示转圈动画
- 修复 CI 失败：清理未使用的 `StreamingCursor`，并将 TypingEffect 改为 render-phase 状态调整，规避 eslint `react-hooks/set-state-in-effect` 报错

### Contributors

- @nillikechatchat（yuanhenglizhen2050@163.com）
- @LUOSENGWA（101017075+LUOSENGWA）
- @monkeycode-ai（平台 AI 协作者）

### Version Updates

- Dashboard 发布标签从 `v1.2.3` 更新至 `v1.2.3.1`

## v1.2.4 (2026-08-14)

### New Features

- **问天插件：AI 深度诊断与日志分析合并为「AI 日志分析诊断」**：
  - 填写症状描述 → 点击「AI 日志分析诊断」，一次完成日志实时采集（容器日志 / Agent 会话 / Matrix 消息）与 AI 分析，SSE 进度条 + 流式报告输出；移除原独立的「AI 诊断」按钮与「开始日志分析」入口
  - 诊断 Prompt 重写并贴合 AgentTeams：角色为平台资深 SRE，内置 Controller/Worker（OpenClaw/Hermes/CoPaw）/团队/Human/Matrix/MinIO/Higress AI 网关模块知识与常见故障域清单；输出结构带严重程度徽章、诊断概要表、事件时间线表、按置信度排序的根因分析、可执行修复命令（bash/yaml 代码块）
  - **日志真实进入 Prompt**：容器日志尾部（单容器 16KB / 总量 96KB 上限）、docker inspect facts（state/exitCode/OOMKilled/重启次数）、Agent 会话摘录（12 个文件 / 32KB 上限）随症状描述与 Dashboard 环境快照一起交给 LLM；此前日志只做统计未进入分析
  - 诊断模型可选：默认模型（服务器 `AGENTTEAMS_DEFAULT_MODEL`）、「模型管理」已配置的服务商模型（经 Higress AI 路由解析）、内置别名与自定义别名；API Key 仍仅保存在服务端
  - 报告渲染美化：react-markdown 自定义渲染器（章节分隔线、表格样式、代码块复制按钮、流式光标），报告头部显示所用模型与时间，支持一键复制全文

### Improvements

- **日志收集迁入问天诊断页**：原设置对话框「日志收集」页签整体迁移为「AI 日志分析诊断」卡片的「日志收集配置」功能区（时间范围 / 容器过滤 / 房间过滤 / PII 脱敏 / Matrix 状态提示），参数直接供 AI 诊断复用；设置对话框由 5 个页签精简为 4 个
- 修复服务端解析 LLM SSE 流未缓冲导致的 token 丢失风险（`data:` JSON 跨网络分块时可能被丢弃）
- 清理问天插件死代码（`collectAndAnalyzeLogs`、`InfraLine`、`SEVERITY_LABELS` 等）

## v1.2.3 (2026-08-13)

### New Features

- **问天诊断插件 (WenTian)**: 新增运行时诊断助手插件，提供：
  - 集群健康概览：Worker/Team/Human 分布、基础设施状态（MinIO/Matrix/Higress）、版本一致性检查
  - AI 深度诊断：输入症状描述，调用 AgentTeams SRE 专家 Prompt 模板，输出结构化 Markdown 报告（问题摘要、日志时间线表格、根因分析、临时/根本修复方案、预防措施、需补充信息）
  - 日志分析：SSE 实时进度条展示采集进度（扫描容器 → 拉取日志 → 会话导出 → Matrix 消息 → AI 分析），结果始终可见
  - 诊断报告可一键复制到剪贴板

### Improvements

- **AI 诊断结果 Markdown 渲染**：诊断结果和日志分析结果均支持 GFM Markdown 渲染（表格、代码块、列表等）
- **问天诊断 Prompt 优化**：替换为完整的 AgentTeams SRE 专家故障排查模板，覆盖 7 步分析流程（提炼症状 → 日志扫描 → 时间线重建 → 关联上下文 → 假设验证 → 给出方案 → 缺失信息），12 种常见根因类型
- **SSE 解析修复**：修复 `collectSSE` 函数无法正确解析 `event:` 字段导致所有事件被识别为 `data` 的 bug，进度条现在能实时更新（0%→95%→完成）
- **诊断页面精简**：移除已删除路由导致的 404（`/api/agentteams/troubleshoot`），移除基础设施详情大 Card 和健康检查独立 Card，聚焦核心诊断能力

### Bug Fixes

- 修复问天 AI 诊断 404 错误（troubleshoot 路由已删除，改为复用 `wen-tian/logs` SSE 端点）
- 修复日志分析进度条永远停在 0% 的问题（SSE event 字段未正确解析）
- 修复日志分析完成后结果不显示的问题（running 与结果显示互斥逻辑错误）

### Version Updates

- 默认镜像版本从 `v1.2.2` 更新至 `v1.2.3`
