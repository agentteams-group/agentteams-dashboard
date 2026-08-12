# 文档索引

本文档索引 AgentTeams Dashboard 项目文档。

## 架构文档

- [ARCHITECTURE.md](ARCHITECTURE.md) - 系统整体架构与数据流
- [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md) - 开发者入门指南
- [INTERFACES.md](INTERFACES.md) - API 接口与契约
- [AI_GATEWAY_GUIDE.md](AI_GATEWAY_GUIDE.md) - AI 网关多服务商路由配置

## 主题文档

- [theme-customization.md](theme-customization.md) / [theme-customization.zh-CN.md](theme-customization.zh-CN.md) - 主题定制参数说明
- [theme-provider-guide.md](theme-provider-guide.md) - Theme Provider 集成指南

## 功能文档

- [debug-log-collection.md](debug-log-collection.md) - 一键调试日志收集功能
- [plugin-system-guide.md](plugin-system-guide.md) - 插件系统开发指南
- [openclaw-bridge.md](openclaw-bridge.md) - OpenClaw Bridge 实现

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

`.monkeycode/specs/` 目录包含已完成的功能规范文档：

- [chat-unread-sort-rendering/](../.monkeycode/specs/chat-unread-sort-rendering/) - 聊天未读排序渲染
- [dashboard-navigation-cleanup/](../.monkeycode/specs/dashboard-navigation-cleanup/) - 导航清理
- [debug-log-collection/](../.monkeycode/specs/debug-log-collection/) - 调试日志收集
- [openclaw-bridge/](../.monkeycode/specs/openclaw-bridge/) - OpenClaw Bridge
- [plugin-system/](../.monkeycode/specs/plugin-system/) - 插件系统
- [theme-system/](../.monkeycode/specs/theme-system/) - 主题系统
- [theme-system-ux-redesign/](../.monkeycode/specs/theme-system-ux-redesign/) - 主题 UX 重设计
- [theme-system-ux-redesign-v2/](../.monkeycode/specs/theme-system-ux-redesign-v2/) - 主题 UX 重设计 v2
- [theme-system-websocket/](../.monkeycode/specs/theme-system-websocket/) - WebSocket 同步
- [worker-ui-ux/](../.monkeycode/specs/worker-ui-ux/) - Worker UI UX
- [worker-card-v2-chat-runtime-ux/](../.monkeycode/specs/worker-card-v2-chat-runtime-ux/) - Worker 卡片 v2
- [worker-deployment-fix/](../.monkeycode/specs/worker-deployment-fix/) - 部署修复

## 注意事项

- `.monkeycode/docs/` 目录保留作为 Agent 内部知识源，实际使用文档请查看 `docs/` 目录
- `plans/` 目录已归档至 `.monkeycode/specs/`
