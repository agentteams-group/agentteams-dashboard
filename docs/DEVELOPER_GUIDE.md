# AgentTeams Dashboard 开发指南

## 环境

- Node.js 20 或更高版本
- npm
- 可选：运行中的 AgentTeams Controller、Matrix 与 Higress 服务

```bash
npm install
npm run dev
```

开发服务器默认监听 3000 端口。使用 `.env.example` 作为本地配置起点；凭据保持在本地环境配置中。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 构建独立产物 |
| `npm start` | 启动生产构建 |
| `npm run lint` | 运行 ESLint |
| `npm run typecheck` | 运行 TypeScript 类型检查 |
| `npm test` | 运行无需外部服务的 Vitest 单元与组件测试 |
| `npm run test:integration` | 运行集成测试，需要 3000 端口开发服务与对应外部依赖配置 |

## 代码约定

- API 路由位于 `src/app/api/`，目标服务访问通过服务端代理完成。
- 前端请求客户端位于 `src/lib/`，TanStack Query hooks 位于 `src/hooks/`。
- 测试与源码同目录，使用 `.test.ts` 或 `.test.tsx` 后缀。
- 新增外部地址时，先定义服务端校验和超时边界，再连接 UI。

## Matrix 聊天开发

- `src/hooks/use-matrix.ts` 是 Matrix 展示事件的归一化入口：它合并 `m.replace`，统计 `m.thread` 回复，并将线程详情交由 `useMatrixThreadMessages` 通过 relations API 加载。
- `src/lib/a2ui/parser.ts` 处理 A2UI、确认、工作流、legacy 内容和嵌入式 AgentScope runtime repr；`src/lib/a2ui/agent-repr.ts` 专门映射 reasoning 与工具调用消息。
- `org.agentteams.run` 只用于已部署 runtime adapter 的兼容载荷。新运行时接入前应先提供真实 Matrix 事件样例，并扩展对应解析器与测试。
- 修改消息关系或解析逻辑时，运行 `npm test -- --run src/hooks/use-matrix.test.ts src/lib/a2ui/agent-repr.test.ts`，再运行 `npm run typecheck` 和 `npm run lint`。

## Nacos 技能集成

技能中心支持从 Nacos 注册中心自动同步和下载技能包。配置 Nacos 连接的步骤：

1. 在 Dashboard 的技能中心页面点击「Nacos 配置」，填入注册中心 URL（格式 `nacos://host:port/namespace`）。
2. 选择同步模式：`services`（服务发现）或 `skills`（Nacos 3.2+ 技能 API）。
3. 如有认证需求，填入用户名和密码。
4. 点击「同步」按钮，Dashboard 从 Nacos 拉取技能元数据到 MinIO。
5. 创建 Worker 时选择 Nacos 技能，Dashboard 自动按需从注册中心拉取内容并安装。

调试 Nacos 集成时，检查 `src/app/api/agentteams/skills/nacos/` 下的路由日志和 MinIO `skills/` bucket 中的元数据 JSON 文件。Nacos 配置存储在本地文件系统中（`src/lib/skill-center-config.ts`）。

## 技能中心开发

新增技能相关功能时涉及的文件层次：

1. `src/lib/skill-center-types.ts` — 类型与常量定义
2. `src/lib/skill-center-storage.ts` — MinIO 存储操作（元数据 CRUD、全局技能扫描）
3. `src/lib/skill-package.ts` — ZIP 解析（`parseSkillPackage`、`isValidNameSegment`）
4. `src/app/api/agentteams/skills/` — API 路由端点
5. `src/hooks/use-skill-center.ts` — 前端数据 hooks
6. `src/components/dashboard/sections/skills/` — UI 组件

技能包大小上限为 64 MB（`SKILL_PACKAGE_MAX_BYTES`），名称仅允许字母数字、点、下划线和中划线。

## Higress 改造流程

1. 参考 `.monkeycode/specs/higress-ai-gateway/` 的需求、设计和任务清单。
2. Provider 与 Route 变更通过 `/api/higress/*`，浏览器不直接访问 Console。
3. Gateway 数据平面地址与 Console 管理地址分别建模。
4. 需要变更 AgentTeams 运行时合同时，使用 `install/AGENTTEAMS_PATCH.md` 记录的固定源提交和接口边界。
5. 外部模式补丁为 `install/patches/0004-agentteams-external-higress.patch`；它要求部署环境提供 `AGENTTEAMS_AI_GATEWAY_URL`，并将 `AGENTTEAMS_DEFAULT_MODEL` 作为请求模型别名传给 Manager 与 Worker。
6. 在固定 AgentTeams 提交检出中按顺序 clean-apply `0001`、`0002`、`0004` 补丁；`0003-Makefile-dashboard.patch` 当前为空补丁。
7. 运行 `go -C agentteams-controller test ./internal/config` 和 `go -C agentteams-controller test ./internal/service -run TestWorkerEnvBuilderPreservesExternalGatewayAndModelAlias` 验证外部 Gateway 地址与模型别名透传。
8. 完成改动后执行 lint、typecheck 和测试。
9. Manager 和 Worker 的 `model` 表示发送至 Gateway 的请求模型别名；现有非空值保持原样回显和提交，模型管理页根据 AI Route 的 `modelMapping`、`modelPredicates` 与 Provider Token 状态展示别名绑定的路由、目标提供商、目标模型和可用状态。
10. 部署使用外部 Higress 时，设置 `AGENTTEAMS_HIGRESS_ADAPTER_MODE=external`、`AGENTTEAMS_AI_GATEWAY_URL`，并按需设置 `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` 与 `AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS`；安装脚本会将这些配置注入 Dashboard，外部模式不会发现嵌入式 Console。
