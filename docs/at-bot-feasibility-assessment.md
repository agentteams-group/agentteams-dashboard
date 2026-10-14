# AT Bot 可行性评估（参考 DeepSeek Bot / DS-Bot）

> 评估性质：不承诺实现。产出 = 语义澄清 + 参考项目可复用件 + 三条候选路径的工作量拆解 + 技术可行性判断 + 风险 + 推荐排序 + MVP 拆解。日期：2026-10-14。

## 0. 参考项目定位

用户给出的 `github.com/QingJ01/DS-Bot` 本人仓库不可达，实际指向 `QingJ01/DS-Bot-App`（fork 自 `Fei2411/DeepSeek-Bot`）。上游 **DeepSeek Bot（简称 DS Bot，插件包名 `ds-bot`）** 是运行在 DeepSeek Harness（DSH）之上的一个 Bot 团队插件。本项目评估以该上游插件为参考。

DS Bot 一句话：把 DSH 从「单体助手」变成「一支常驻 Bot 团队」——一个主管（Main Bot，默认名 Chief）、若干有独立人设与模型的成员、群聊协作、长期记忆、共享能力库，数据全部落在本地 `~/.dsh/bot/`。

## 1. 术语澄清：「AT Bot」的三种解读

当前项目是 **AgentTeams Dashboard**，是 AgentTeams 集群的 Mission Control（Next.js 控制台），不是 agent 执行宿主。因此「AT bot」至少有两种口径，方案分叉很大，需先定：

| 口径 | 含义 | 主要落点 |
| --- | --- | --- |
| **A. @ Bot（聊天助手型）** | 在 Matrix 房间 @ 一个 bot，得到多角色团队式应答（主管调度 + 群聊 + 记忆） | Dashboard 聊天链 + 一个常驻编排体 |
| **B. AgentTeams Bot 资源型** | 把「常驻 Bot 团队」作为一类被纳管的 AgentTeams 资源（类比 Worker / Manager / Team / Human），Dashboard 提供生命周期与治理 | 上游 Controller 资源模型 + Dashboard section |
| **C. Runtime 化** | 直接把 DS Bot 当作 `deepseek-harness` Worker 的一个 profile 能力跑起来 | 上游 Controller worker 镜像/profile |

下文按 A / B / C 三条路径评估，并给出推荐组合。

## 2. 参考项目（DS Bot）可复用的设计件

以下是 DS Bot 里与本项目直接相关、可移植或可借鉴的核心机制：

| 能力 | DS Bot 落点 | 可复用价值 |
| --- | --- | --- |
| 常驻 Bot = 一个 Session | `ds-bot/src/host/roster.js` 建 Session；`state.json` 存团队 | Bot 身份与生命周期模型 |
| 主管（Main Bot）最高权限 | `roster.js` `setMain`；可增删改 Bot 与群 | 「谁有权管理团队」的权限层 |
| 群聊回合调度 | `ds-bot/src/host/groups.js` 单一有序共享会话、一次一人、admin-first、`[PASS]` 静默、`@Name` 递转 | **群聊编排算法可直接移植** |
| `@` 点名解析（纯函数） | `ds-bot/src/shared/mentions.js`（去代码块/链接/地址、最长名优先、`@all`） | **可直接复用为 Dashboard 的 @ 识别器** |
| 长期记忆 | `ds-bot/src/host/memory.js`（Agent Memory Repo Markdown 格式，双作用域 bot/team，每轮 review 自动写入，大小上限，拒绝密钥） | 记忆数据模型与安全策略 |
| 能力库 | `ds-bot/src/host/capabilities.js`（MCP + skills + packs 共享库，按 Bot 授予） | 与 Dashboard 现有技能中心 / MCP 治理对齐 |
| 上下文管理 | `ds-bot/src/host/steward.js` + `parts.js` + `chat-index.js`（check line 触发 checkpoint 或 handoff，FTS5 全文索引） | 长会话压缩与历史检索 |
| 单一 RPC 通道 | `ds-bot/src/host/channel.js`（`POST api/bot`，客户端只渲染） | 前端/宿主解耦的接口范式 |
| 桌面/移动端 | `apps/mobile`（React Native）+ `packages/mobile-sdk` | 移动端形态参考，非本任务重点 |

**关键结论**：DS Bot 的「群聊回合调度 + @ 解析 + 记忆 + 能力库」是最有复用价值的部分；而它的「Bot 不是 Matrix 用户」这一点，是接入 AgentTeams 时最大的身份错配（见第 5 节）。

## 3. 当前项目的可对接面

| 对接面 | 位置 | 对 AT Bot 的作用 |
| --- | --- | --- |
| 资源模型 | `src/lib/agentteams-api.ts`：`WorkerResponse` / `TeamResponse` / `HumanResponse` / `ManagerResponse` 均含 `matrixUserID` + `roomID` | 每个成员天然可拥有 Matrix 身份与房间 |
| Worker runtime | `WorkerRuntime` 含 `deepseek-harness`（`src/lib/runtime-options.ts` 标注「实验」） | 路径 C 的入口已存在 |
| Matrix 消息总线 | `src/lib/matrix-api.ts`、`src/app/api/matrix/*`、`src/hooks/use-matrix.ts` | 房间/消息/成员/同步全部已有代理 |
| 聊天渲染链 | `src/components/dashboard/sections/chat/`、`src/lib/a2ui/protocol.ts` | 已支持 A2UI、`org.agentteams.run` v1 五类块、workflow、Tool Guard 确认 |
| HITL 收件箱 | `src/lib/hitl-inbox.ts`、`hitl-inbox-card.tsx` | 审批/暂停统一汇聚，可直接承接 Bot 的确认请求 |
| 技能中心 / MCP 治理 | `src/app/api/agentteams/skills/*`、`src/app/api/agentteams/mcp-catalog/*` | 作为 Bot 的 Capabilities 来源 |
| 治理 | `src/middleware.ts`、`enforceServerSideRbac`、`src/lib/audit-log.ts` | Bot 操作的 RBAC 与审计 |
| 插件系统 | `docs/plugin-system-design.md`（5 个扩展点 + 动态加载） | 路径 A 的零上游实现载体 |
| Manager（Leader） | `ManagerResponse` + `managers-section.tsx`，经 `projectflow` 编排项目 | 「主管调度」在 AgentTeams 里的既有类比 |

**架构边界**：Dashboard 通过 Next.js 路由代理 Controller / Matrix / Higress / MinIO / Nacos（见 `docs/ARCHITECTURE.md`）。它**不自带常驻执行体**——Bot 的模型调用与长期运行必须落在 Controller 侧容器或一个独立服务里。这条边界决定路径 A 需要补一个常驻进程。

## 4. 三条候选路径

### 路径 A：Dashboard 原生 @ Bot（轻量先导，零上游改动）

- **思路**：不改 runtime。用 Dashboard 插件系统 + 现有 Matrix 代理做编排层：Dashboard 侧维护一组「Bot 配置」（角色 + 请求模型别名 + 技能/MCP + 记忆文件），执行体复用现有 Worker / Manager；在房间监听 `@Name`（复用 `mentions.js` 纯函数），路由给对应执行体，把回复以 `org.agentteams.run` v1 块投回房间；群聊回合调度在编排层实现。
- **优点**：完全落在现有能力内；验证 @ Bot 价值的成本最低；消息链前向兼容（未知协议自动回退文本），增量接入安全。
- **缺点**：Next.js 无常驻 loop，需要独立常驻编排服务 + Matrix bot/appservice 账号；记忆需自建存储（可落 MinIO + 审计）；生产化后本质仍是自研编排。
- **量级**：编排服务（群聊回合 + @ 路由 + 记忆最小集）5-10 人日；Dashboard 侧面板与渲染复用，1-2 人日。

### 路径 B：AT Bot 一等资源（推荐主路线）

- **思路**：把 DS Bot 的模型映射为 AgentTeams 资源：
  - 一个 Bot = 一个 Controller 资源，带 `matrixUserID` + 私聊房间（复用 Worker/Manager provisioning）。
  - Main Bot = 拥有管理其他 Bot 权限的角色（复用 Manager 的 leader 语义与 RBAC）。
  - 群聊 = 一个 Matrix 房间，成员为多个 Bot 的 `matrixUserID` + Human。
  - `@` 点名 / admin-first 回合 / `[PASS]` 静默 = Controller 侧 group-router channel 插件（移植 `groups.js` + `mentions.js`）。
  - 记忆 = Dashboard 侧存储（MinIO + 审计 + RBAC）或 Controller 侧；Capabilities 直接复用技能中心 / MCP 治理。
- **优点**：Bot 是真正的 Matrix 用户，可被 @；Dashboard 现有 chat / HITL / RBAC / 审计 / 技能中心全部复用；符合 AgentTeams 资源化范式。
- **缺点**：需上游 Controller 新增资源类型 + channel 插件（大工程）；Dashboard 新增 Bot section 与群管理面板。
- **量级**：Controller 侧新资源 + channel（参照 qwenpaw channel 全量实现，每 runtime 3-8 人日的口径）约 10-20 人日；Dashboard 侧 Bot/群管理 + 记忆面板约 5-8 人日。

### 路径 C：DS Bot 作为 deepseek-harness Worker 的 profile 能力（可选项）

- **思路**：在 `deepseek-harness` Worker 的 profile 里安装 `ds-bot` 插件，让一个 Worker 内部养一个 Bot 团队。
- **优点**：复用上游 DS Bot 全部实现；Controller 侧只需镜像/profile 支持；Dashboard 侧近乎零改动（`runtime-meta.ts` 已就绪）。
- **致命问题**：两套群聊/身份语义冲突——DS Bot 的成员不是 Matrix 用户，无法被房间 @ 到；AgentTeams Worker channel 与 DS Bot 内部群聊各管一套回合。它更像是「一个 Worker 里跑了一条独立团队」，没有和 AgentTeams 的身份/治理打通。
- **量级**：Controller 为主 3-8 人日。
- **定位**：作为实验能力保留，不解决 @ 身份与治理主线。

## 5. 技术可行性判断

**总体可行（高）**。三块底层能力都已存在：Matrix 身份与房间、runtime 会话与流式、Dashboard 渲染与治理；缺的两块（群聊编排调度、Bot 资源化与记忆）都有 DS Bot 的成熟参考实现。

主要风险：

1. **双群聊模型冲突**：DS Bot 内部群聊 vs Matrix 房间。必须二选一——路径 B 明确以 Matrix 房间为唯一群聊载体。
2. **身份归属错配**：DS Bot 的 Bot 不是 Matrix 用户。任何要「@ 得到应答」的方案都必须给每个成员分配 Matrix 身份（路径 B）或由编排层代答（路径 A）。
3. **无常驻执行体**：Dashboard 是控制台。路径 A 要补独立服务；路径 B 依赖 Controller channel。
4. **上游依赖**：路径 B/C 均需 Controller 侧改动，受上游版本节奏约束（见 `docs/INTERFACES.md`「上游版本对照记录」与 weekly drift cron）。
5. **记忆与密钥合规**：DS Bot 记忆是 Markdown、密钥拒绝入库、`secrets.json` 600；接入 Dashboard 后需对齐审计与凭据隔离（Dashboard 现有 Provider Token 不回传浏览器的既有约束）。
6. **兼容性**：消息链未知协议回退文本启发式（`docs/INTERFACES.md`），因此新协议可渐进上线，不会炸历史。

## 6. 推荐排序

1. **路径 A 先导（1-2 周，零上游）**：先验证「@ Bot + 群聊调度」的用户价值，同时用它把 `mentions.js` / 回合调度 / 记忆最小集跑通。
2. **路径 B 立项（推荐主路线）**：价值被验证后，把 Bot 资源化，复用 AgentTeams provisioning 与 Dashboard 全套治理，是唯一能同时满足「可 @ 身份 + 平台治理」的形态。
3. **路径 C 观察位**：作为 `deepseek-harness` runtime 的一个实验 profile 保留，单独不立项。

## 7. MVP 最小集拆解（A / B 公共部分）

| 工作流 | 交付物 | 归属 |
| --- | --- | --- |
| @ 识别 | 复用 `mentions.js`（去代码块/链接/地址、最长名优先、`@all`） | Dashboard（纯函数，零成本） |
| 群聊回合调度 | admin-first、一次一人、`@Name` 递转、`[PASS]` 静默 | 路径 A 编排服务 / 路径 B Controller channel |
| 成员身份 | 每成员 `matrixUserID` + 房间 | 路径 B：Controller provisioning |
| 消息协议 | 输出映射为 `org.agentteams.run` v1 五类块（text/thinking/tool_call/confirmation/error） | 适配器（渲染端零改动） |
| 记忆最小集 | Bot 自记忆 + 团队共享记忆，Markdown，大小上限，拒绝密钥 | Dashboard（MinIO + 审计）/ Controller |
| Capabilities | 复用技能中心 + MCP 治理，按 Bot 授予 | Dashboard（已就绪） |
| HITL | 确认请求进 `hitl-inbox-card`，确认回复回投房间 | Dashboard（已就绪） |
| 治理 | Bot 写操作走 `enforceServerSideRbac` + 审计 | Dashboard（已就绪） |

## 8. 立项判据

- 路径 A 先导验证后，用户确认需要原生卡片 / 会话回放 / 可 @ 身份，而非纯文本；
- 上游 Controller 有意愿新增 Bot 资源与 channel（依赖上游对齐通道）；
- 记忆与密钥的合规边界被目标用户接受；
- 明确「AT Bot」语义 = 路径 A（轻量 @）还是路径 B（资源化）——这是当前必须由用户拍板的第一决策点。

## 9. 相关文档

- 参考项目：`Fei2411/DeepSeek-Bot`（本仓评估时浅克隆于 `/tmp/ds-bot`）、`QingJ01/DS-Bot-App`（fork）
- 运行时接入先例：`docs/external-runtime-integration-assessment.md`
- 消息协议：`docs/INTERFACES.md`「运行时块协议」
- 架构边界：`docs/ARCHITECTURE.md`
- 运行时能力清单：`docs/runtime-capabilities.md`
