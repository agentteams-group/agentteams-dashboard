# Requirements Document

## Introduction

本规格覆盖 AgentTeams Dashboard 四项体验与治理升级：面板密钥/环境变量自动生成与持久化；嵌入式部署下后端地址自动探测并预填（可编辑）；对照主流多 Agent 面板的对话优先布局；Matrix 房间邀请的发现、接受与拒绝。全程叠加代码质量与安全治理约束（密钥落盘权限、SSRF/允许列表、RBAC、审计、日志脱敏）。

本规格建立在已落地的 F1 后端双地址配置（`src/lib/backend-config.ts`）、安装脚本 `install/agentteams-dashboard.sh`、分组导航 `src/components/dashboard/nav-items.ts`、以及 Matrix 长轮询 `src/hooks/use-global-matrix-sync.ts` 之上。

## Glossary

- **System**：AgentTeams Dashboard（Next.js 控制台及其安装脚本）。
- **Operator**：持有 Dashboard 会话的人类用户。
- **Installer**：`install/agentteams-dashboard.sh` 及其非交互模式。
- **Embedded Deployment**：Dashboard 与 Controller / Tuwunel / MinIO / Higress 同处 `agentteams-net` 的单机 Docker 拓扑。
- **Standalone Mode**：`DASHBOARD_SHARED_MODE` 未设为 `1` 的单用户实例。
- **Shared Mode**：`DASHBOARD_SHARED_MODE=1` 的多用户实例。
- **Setup Token**：登录前写后端配置的门禁凭据（`DASHBOARD_SETUP_TOKEN` 或数据卷 `.setup-token`）。
- **Session Secret**：签署 HttpOnly 会话 cookie 的 HMAC 密钥（`DASHBOARD_SESSION_SECRET`，≥32 字节 hex）。
- **Backend Config File**：服务端 JSON（默认 `/data/agentteams-dashboard/config.json`），优先级高于环境变量。
- **Embedded Defaults**：`EMBEDDED_DEFAULTS`（`src/lib/backend-names.ts`）中的容器内网地址。
- **Required Backends**：`controller` 与 `matrix`。
- **Matrix Invite**：Client-Server `/sync` 的 `rooms.invite` 段中、当前用户 `membership=invite` 的房间。
- **Invite Inbox**：聊天侧栏中展示待处理邀请的区域。
- **Conversation-First Shell**：以聊天工作区为默认主表面、资源管理为次级表面的布局。
- **Secret File**：数据卷上 mode `0600` 的密钥文件（`.setup-token`、`.session-secret`）。

## Requirements

### Requirement 1：面板密钥与环境自动生成

**User Story:** AS 部署者, I want Dashboard 在嵌入式安装与进程启动时自动生成并持久化会话密钥与 setup token, so that 首次启动即可登录且重建容器后会话签署密钥保持稳定。

#### Acceptance Criteria

1. WHEN Installer 检测到 `DASHBOARD_SESSION_SECRET` 为空，Installer SHALL 调用 `openssl rand -hex 32` 生成密钥，写入 `${HOME}/.agentteams-dashboard.env`（mode `0600`），并以 `-e DASHBOARD_SESSION_SECRET` 注入容器。
2. WHEN Installer 创建或重建 Dashboard 容器，Installer SHALL 挂载命名卷 `agentteams-dashboard-data` 到 `/data/agentteams-dashboard`，并设置 `DASHBOARD_CONFIG_FILE=/data/agentteams-dashboard/config.json`。
3. WHEN Installer 探测到容器 `agentteams-controller` 在 `agentteams-net` 上健康，Installer SHALL 将 `AGENTTEAMS_DEPLOYMENT_MODE=embedded` 写入 env 文件并注入容器。
4. WHEN Standalone Mode 且 `isSetupTokenEnforced()` 为真且环境未提供 `DASHBOARD_SETUP_TOKEN`，进程启动时 Dashboard SHALL 调用现有 `bootstrapSetupToken()`，将 32 位 hex token 以 mode `0600` 写入配置目录 `.setup-token`，并向 stderr 打印一行 `[dashboard] one-time backend setup token: <token>`。
5. WHEN Standalone Mode 且 `DASHBOARD_SESSION_SECRET` 缺失或短于 64 个 hex 字符，进程启动时 Dashboard SHALL 生成 32 字节 hex 密钥，以 mode `0600` 写入配置目录 `.session-secret`，设置进程内环境供本进程使用，并向 stderr 打印指纹日志（仅后 4 位，完整密钥禁止进入日志）。
6. WHEN Shared Mode 且 `DASHBOARD_SESSION_SECRET` 缺失或过短，Dashboard SHALL 保持现有 fail-closed：拒绝创建会话，并向 stderr 打印配置缺失错误。
7. WHEN Shared Mode，Dashboard SHALL 仅从 `DASHBOARD_SETUP_TOKEN` 环境变量读取 setup token，跳过文件生成与落盘。
8. WHEN `DASHBOARD_SETUP_TOKEN_ENFORCE=0`，Dashboard SHALL 跳过 setup token 的生成、打印与落盘（与现有 F1f3 行为一致）。
9. WHEN 配置目录已存在 `.session-secret`，后续启动 Dashboard SHALL 读取该文件并复用，保持 cookie 签署密钥在容器重建后稳定（卷仍在的前提下）。

### Requirement 2：嵌入式后端地址自动获取与可编辑

**User Story:** AS Operator, I want 嵌入式部署下后端地址被自动探测并填入表单且仍可手工修改, so that 首次登录与设置页无需手抄容器内网地址。

#### Acceptance Criteria

1. WHEN 后端配置尚未满足 Required Backends，`GET /api/agentteams/setup/backends` SHALL 并行探测 `EMBEDDED_DEFAULTS` 中已定义地址（超时 2000ms），并在响应的 `embedded.healthy` 中返回每个后端的 `httpOk` 布尔值。
2. WHEN `embedded.healthy` 中 Required Backends 均为 true，首次启动设置页 SHALL 把对应 `EMBEDDED_DEFAULTS` 预填到「内网地址」输入框；Operator 可在保存前编辑任意槽位。
3. WHEN `embedded.healthy` 中至少一个 Required Backend 为 false，首次启动设置页 SHALL 保持空表单，并展示「使用内置默认地址」按钮（现有手动应用路径保留）。
4. WHILE Operator 已登录且部署模式为 `embedded`，设置页「后端」标签 SHALL 对空的内网槽位显示嵌入式默认值作为可编辑草稿，并在该槽位旁标注「嵌入式探测」。
5. WHEN Operator 保存后端配置，Dashboard SHALL 以现有 `updateConfig` / `saveConfigOneShot` 合并语义写入配置文件（已提交后端替换自身条目，未提交后端保留）。
6. WHILE Shared Mode，仅 dashboard level 3 会话的保存请求 SHALL 被接受；level 低于 3 的保存请求 SHALL 得到 HTTP 403 与现有错误体 `shared-mode: only admin (L1) may save backend config`。
7. WHEN 登录前调用方请求完整拓扑（candidates / effective / 已存地址），Dashboard SHALL 要求有效 setup token；匿名响应仅包含 `configured`、`setupTokenRequired`、`embedded.defaults`、`embedded.healthy`。
8. WHEN 登录前 setup token 用于预填，客户端 SHALL 通过 `Authorization: Bearer <token>` 或 JSON body 传递 token；query string `?token=` 作为一轮兼容别名，新代码路径以 header/body 为准。
9. IF 探测目标主机落在链路本地或云元数据地址（含 `169.254.0.0/16`、`fe80::/10`、已知 metadata DNS），`isTestTargetAllowed` SHALL 拒绝该探测。

### Requirement 3：对话优先的多 Agent 面板布局

**User Story:** AS Operator, I want Dashboard 采用主流多 Agent 控制台的对话优先三栏布局, so that 日常协作从聊天进入，资源管理保持可达且认知负荷更低。

#### Acceptance Criteria

1. Dashboard 主壳 SHALL 保持 `nav-items.ts` 现有三组导航（基础、运行时、资源中心），并以聊天作为无记忆时的默认主表面；中间工作区在聊天 section 使用现有三栏，其它 section 使用现有资源页。
2. WHEN Operator 完成登录且 URL 无 section hash、localStorage 无有效 `agentteams-active-section`，Dashboard SHALL 将默认主表面设为 `chat`。
3. WHILE 主表面为 `chat`，中间工作区 SHALL 复用现有三栏聊天：房间列表（可折叠、宽度 176–448px 持久化）、消息列、右侧成员/文件/线程面板。
4. WHILE 主表面为运行时或资源分组，中间工作区 SHALL 渲染对应现有 section（Workers / Teams / Managers / Humans / 任务看板 / 产物 / 市场 / 模型 / 知识库 / 审计），分组折叠状态持久化到 localStorage。
5. 侧栏聊天入口 SHALL 展示未读房间数与待处理邀请数之和（上限展示 `99+`）。
6. 总览页 SHALL 继续承载 HITL 收件箱卡片；该卡片增加「待接受的 Matrix 邀请」计数，点击跳转 `#chat` 并打开 Invite Inbox。
7. 现有 `#section` 深链接与 `SECTION_ALIASES`（如 `projects` → `tasks`）SHALL 继续解析到对应 section。
8. 窄视口（`max-width: 767px`）下，房间列表 SHALL 默认折叠，消息列占满中间工作区（与现有 A11Y-03 行为一致）。

### Requirement 4：Matrix 邀请收件箱

**User Story:** AS Operator, I want 在聊天侧栏看到并处理发给我的 Matrix 房间邀请, so that 我能加入团队房间而无需使用外部 Matrix 客户端。

#### Acceptance Criteria

1. WHEN `/sync` 响应包含 `rooms.invite`，全局同步循环 SHALL 解析每个邀请房间的 roomId、邀请者 MXID、房间名（来自 `invite_state` 中的 `m.room.name` 或邀请者 displayname），并写入客户端邀请 store。
2. WHEN `/sync` 随后在 `rooms.join` 出现同一 roomId，邀请 store SHALL 移除该条目。
3. WHEN `/sync` 在 `rooms.leave` 出现同一 roomId 且本地无加入成功记录，邀请 store SHALL 移除该条目（对端撤回或本端已拒绝）。
4. 聊天房间列表顶部 SHALL 渲染 Invite Inbox：每条展示房间名（缺省时 roomId）、邀请者本地名、接受按钮、拒绝按钮。
5. WHEN Operator 点击接受，Dashboard SHALL 通过服务端代理对允许列表内 homeserver 发出 `POST /_matrix/client/v3/rooms/{roomId}/join`（空 JSON 体），成功后将该房间并入已加入列表并选中。
6. WHEN Operator 点击拒绝，Dashboard SHALL 通过服务端代理发出 `POST /_matrix/client/v3/rooms/{roomId}/leave`，成功后从 Invite Inbox 移除该条目。
7. IF join 或 leave 返回 4xx/5xx，Invite Inbox SHALL 在该条目上展示服务端 `errcode`/`error` 摘要，并保持该邀请可见以便重试。
8. roomId 路径参数 SHALL 匹配 Matrix 房间 ID 形状 `![A-Za-z0-9._=/+-]+:[A-Za-z0-9.-]+`；形状不匹配的请求 SHALL 得到 HTTP 400。
9. join/leave 代理 SHALL 使用现有 `validateHomeserverUrl(url, { requireAllowlist: true })`；Authorization 仅接受请求头 Bearer，拒绝 query string 令牌。
10. WHEN join 或 leave 成功，Dashboard SHALL 追加一条 warning 级审计事件，字段包含 actor、roomId、动作 `matrix.invite.accept` 或 `matrix.invite.reject`。

### Requirement 5：代码质量与安全治理（横切）

**User Story:** AS 平台管理员, I want 上述功能满足密钥隔离、代理边界与审计约束, so that 体验改动不扩大攻击面。

#### Acceptance Criteria

1. Secret File 的写入模式 SHALL 为 `0600`；目录由 Dashboard 以 `0700` 创建（已存在目录保持其模式）。
2. 日志与 4xx/5xx JSON 响应 SHALL 使用固定对外文案；`DASHBOARD_SESSION_SECRET`、Matrix access token、Controller SA token 的完整值禁止出现在响应体与 `console.error`/`console.warn` 以外的启动指纹行（setup token 启动行是唯一允许打印完整一次性门禁的例外，与现有 F1e 合同一致）。
3. 后端地址探测与保存继续受 `DASHBOARD_ALLOWED_HOSTS` 与元数据地址拒绝规则约束；新增 join/leave 路由禁止接受调用方提供的任意 URL 作为上游（homeserver 仅来自已校验 query `homeserver`）。
4. 写后端配置、接受/拒绝邀请的路由 SHALL 在有会话时走 Dashboard 会话身份；Shared Mode 下写后端配置额外要求 level 3。
5. 新增与修改的 TypeScript 模块 SHALL 附带同目录单元测试，覆盖：密钥生成/复用/Shared fail-closed、嵌入式预填条件、邀请 ingest（invite→join→drop、invite→leave→drop）、roomId 形状拒绝、allowlist 拒绝。
6. 本功能合入前验证顺序 SHALL 为 `./node_modules/.bin/tsc --noEmit` → eslint（仅改动文件）→ `./node_modules/.bin/vitest run`（改动相关测试文件）。
7. 服务端新增路由的错误路径 SHALL 返回稳定 `error` 码（如 `invalid-room-id`、`homeserver-not-allowed`、`join-failed`），禁止把上游堆栈或内部异常原文回传给浏览器。
