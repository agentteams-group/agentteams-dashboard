# AgentTeams Dashboard 开发指南

## 环境

- Node.js 22 或更高版本
- npm
- 可选：运行中的 AgentTeams Controller、Matrix 与 Higress 服务

```bash
npm ci --no-audit --no-fund --legacy-peer-deps
npm run dev
```

开发服务器默认监听 3000 端口，输出同步写入 `dev.log`（生产 `npm start` 同理写 `server.log`）。`npm run dev` 会先执行 `prepare:speech`，把固定版本的 Whisper tiny 模型与 WASM 备到 `public/speech/`（约 65 MB，首次较慢，可用 `SPEECH_MODEL_DOWNLOAD_BASE_URL` 指向镜像）。使用 `.env.example` 作为本地配置起点；凭据保持在本地环境配置中。

## 常用命令

| 命令 | 用途 |
|---|---|
| `npm run dev` | 准备语音资源并启动开发服务器 |
| `npm run prepare:speech` | 单独下载语音模型资产 |
| `npm run build` | 构建 standalone 产物（含语音资产） |
| `npm start` | 启动生产构建 |
| `npm run lint` | ESLint + 排版扫描 |
| `npm run lint:tone` | AI 味文案扫描（可见文案硬词门禁） |
| `npm run lint:typography` | 仅排版扫描 |
| `npm run typecheck` | TypeScript 类型检查（覆盖 `**/*.ts`，含 `next.config.ts`） |
| `npm test` | 运行无需外部服务的 Vitest 单元与组件测试 |
| `npm run test:watch` | Vitest watch 模式 |
| `npm run test:coverage` | Vitest 覆盖率 |
| `npm run test:integration` | 集成测试，需要 3000 端口开发服务与对应外部依赖配置 |
| `bash scripts/check-docs-consistency.sh` | 文档一致性门禁（陈旧字符串 / 安装器版本 / 链接） |
| `bash install/agentteams-dashboard-tests.sh` | 安装器断言（62 用例） |

> 验证顺序建议：`npm run typecheck` → `npm run lint` → `npm test`。tsconfig 的 include 覆盖 `**/*.ts`，改配置文件后同样需要 typecheck。

## 代码约定

- API 路由位于 `src/app/api/`，目标服务访问通过服务端代理完成；代理工具集中在 `src/app/api/agentteams/proxy-helper.ts`。
- 前端请求客户端位于 `src/lib/`，TanStack Query hooks 位于 `src/hooks/`。
- 测试与源码同目录，使用 `.test.ts` 或 `.test.tsx` 后缀；需要真实后端的用例放 `src/__tests__/integration/`。
- 新增外部地址时，先定义服务端校验和超时边界，再连接 UI。
- 导航与深链：一级入口在 `workspace-navigation.tsx`，二级项与等级门控在 `nav-items.ts`，分层哈希唯一映射层是 `src/lib/nav-hash.ts`（不要在业务代码里手写哈希字符串）。

## 模块导览

| 模块 | 位置 | 说明 |
|---|---|---|
| 工作区外壳与导航 | `src/components/dashboard/agent-teams-dashboard.tsx`、`workspace-navigation.tsx`、`nav-items.ts` | section 注册、菜单、创建动作、通知计数 |
| 设置弹窗 | `src/components/dashboard/settings/` | 后端配置、主题、插件、更新、语音、管理页（总览/审计/诊断/插件贡献入口） |
| 任务看板 / 产物 / 编码执行 / 循环 | `src/components/dashboard/sections/{tasks,artifacts,coding-runs,loops}-section.tsx` | 项目干预、产物树、只读执行记录、循环定义 |
| 聊天与运行时渲染 | `src/components/dashboard/sections/chat/`、`src/lib/a2ui/` | Matrix 事件归一化、A2UI/运行时块渲染、HITL 卡片 |
| 资产中心 | `sections/{models,mcps,skills,knowledge,files}-section.tsx` | 模型别名与可用性、MCP 治理、技能中心、知识库、文件区 |
| 观测与治理 | `sections/{tracing,audit}-section.tsx`、`src/lib/observability-*`、`agentloop-server.ts` | 可观测配置、双轨查询后端、审计列表 |
| 插件运行时 | `src/lib/plugins/`、`src/components/plugins/`、`tools/create-dashboard-plugin/` | 插件加载、扩展点、错误隔离、脚手架 |

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
4. 需要变更 AgentTeams 运行时合同时，参考 `install/AGENTTEAMS_PATCH.md` 记录的接口边界，并通过 PR 将变更直接提交到 `agentscope-ai/AgentTeams`（基于补丁文件的流程已于 2026-09 废弃）。
5. 外部模式要求部署环境提供 `AGENTTEAMS_AI_GATEWAY_URL`，并将 `AGENTTEAMS_DEFAULT_MODEL` 作为请求模型别名传给 Manager 与 Worker；参考实现保存在本仓库 `install/agentteams-install.sh` 与 `install/agentteams-dashboard.sh`，待通过 PR 合入上游。
6. 在包含外部 Higress 改动的 AgentTeams 检出中运行 `go -C agentteams-controller test ./internal/config` 和 `go -C agentteams-controller test ./internal/service -run TestWorkerEnvBuilderPreservesExternalGatewayAndModelAlias` 验证外部 Gateway 地址与模型别名透传。
8. 完成改动后执行 lint、typecheck 和测试。
9. Manager 和 Worker 的 `model` 表示发送至 Gateway 的请求模型别名；现有非空值保持原样回显和提交，模型管理页根据 AI Route 的 `modelMapping`、`modelPredicates` 与 Provider Token 状态展示别名绑定的路由、目标提供商、目标模型和可用状态。
10. 部署使用外部 Higress 时，设置 `AGENTTEAMS_HIGRESS_ADAPTER_MODE=external`、`AGENTTEAMS_AI_GATEWAY_URL`，并按需设置 `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` 与 `AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS`；安装脚本会将这些配置注入 Dashboard，外部模式不会发现嵌入式 Console。
