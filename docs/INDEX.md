# 文档索引

本文档索引 AgentTeams Dashboard 项目文档。

## 架构文档

- [ARCHITECTURE.md](ARCHITECTURE.md) - 系统整体架构与数据流
- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) - 开发者入门指南
- [INTERFACES.md](INTERFACES.md) - API 接口与契约
- [AI_GATEWAY_GUIDE.md](AI_GATEWAY_GUIDE.md) - AI 网关多服务商路由配置
- [runtime-capabilities.md](runtime-capabilities.md) - Worker 运行时能力对照表（流式协议 / 模型接入 / 知识库数据面）
- [external-runtime-integration-assessment.md](external-runtime-integration-assessment.md) - 外部 coding agent runtime 接入评估（B6）

## 主题文档

- [theme-customization.md](theme-customization.md) / [theme-customization.zh-CN.md](theme-customization.zh-CN.md) - 主题定制参数说明

## 功能文档

- [debug-log-collection.md](debug-log-collection.md) - 一键调试日志收集功能
- [plugin-development.md](plugin-development.md) / [plugin-development.zh-CN.md](plugin-development.zh-CN.md) - 插件开发指南
- [plugin-system-design.md](plugin-system-design.md) - 插件系统设计
- [项目.md](项目.md) - 项目（Projects）功能使用指南（用户视角）
- [项目开发.md](项目开发.md) - 项目（Projects）开发指南（组件结构、API 客户端、缓存策略）

## 概念文档

### 专有概念
- [技能中心.md](专有概念/技能中心.md)
- [模型别名绑定.md](专有概念/模型别名绑定.md)
- [部署模式.md](专有概念/部署模式.md)

### 模块
- [Dashboard.md](模块/Dashboard.md)
- [技能中心.md](模块/技能中心.md)
- [服务端API.md](模块/服务端API.md)
- [部署与交付.md](模块/部署与交付.md)

## 历史 Spec

`.monkeycode/specs/` 目录包含已完成的功能规范文档（任务书 requirements/design/tasklist 归档地），目录内容以实际为准；其中 `dashboard-optimization/` 是当前推进中的优化总计划（含任务列表与归档设计稿）。

## 注意事项

- `.monkeycode/docs/` 目录保留作为 Agent 内部知识源，实际使用文档请查看 `docs/` 目录
- `plans/` 目录已归档至 `.monkeycode/specs/`
