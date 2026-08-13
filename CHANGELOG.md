# Changelog

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
