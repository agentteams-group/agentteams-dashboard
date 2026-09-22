# 需求实施计划

- [x] 1. 改造安装脚本卷挂载与默认镜像（F-1 / F-2 / 默认镜像升级）
  - [x] 1.1 在 `install/agentteams-dashboard.sh` 改动：缺 `DASHBOARD_SESSION_SECRET` 时 `openssl rand -hex 32` 写入 env 文件；`docker run` 挂载 `-v agentteams-dashboard-data:/data/agentteams-dashboard`；注入 `-e DASHBOARD_CONFIG_FILE=/data/agentteams-dashboard/config.json`；探测到 controller 在 `agentteams-net` 时注入 `-e AGENTTEAMS_DEPLOYMENT_MODE=embedded`；废弃 `/app/db`；把 `DEFAULT_DASHBOARD_VERSION` 改为 `v1.2.4.9`
  - [x] 1.2 在 `install/agentteams-install.sh` 改动：同上四件事（密钥生成落盘 env、卷挂 `/data/agentteams-dashboard`、注入 `DASHBOARD_CONFIG_FILE`、探测到 controller 注入 `AGENTTEAMS_DEPLOYMENT_MODE=embedded`）；新增 `/app/db` 内容探测→一次双挂兼容旧卷；把 `AGENTTEAMS_DASHBOARD_VERSION` 默认值 `v1.2.2` 改为 `v1.2.4.9`
  - [x] 1.3 在 `install/agentteams-dashboard.ps1` 把 `[string]$DashboardVersion = "v1.2.2"` 改为 `"v1.2.4.9"`
  - [x] 1.4 在 `install/agentteams-dashboard-tests.sh` 把写死的 `v1.2.2` 字面量（4 处）改为 `v1.2.4.9`

- [x] 2. 会话密钥进程内引导（F-2 续 / 需求 1.4-1.9）
  - [x] 2.1 在 `src/lib/dashboard-session.ts` 新增 `bootstrapSessionSecret()`：Standalone + 密钥缺失或短于 64 hex 时，`randomBytes(32).toString('hex')` 生成值；配置目录以 `0700` 创建（已存在保留）；写 `.session-secret` mode `0600`；设置 `process.env.DASHBOARD_SESSION_SECRET`；stderr 输出 `[dashboard] session secret fingerprint: …xxxx`（仅后 4 位）；Shared Mode 直接走现有 fail-closed（不写盘）
  - [x] 2.2 在 `src/lib/dashboard-session.ts` 把 `getSecret()` / `requireSecret()` 改为：先看 env（已含 bootstrap 注入），再读 `configDir()/.session-secret`（存在且合法则填入 env 并返回），共享模式永不读盘
  - [x] 2.3 在 `src/instrumentation.ts` 把 `bootstrapSessionSecret()` 加入 `register()` 流程（与 `bootstrapSetupToken()` 并列；共用 try/catch；写盘失败仅 stderr警告，不阻断本进程）
  - [x] 2.4 改动 `login` 路由 502 响应体：剥离「密钥缺失」原文错误，按现有 SEC-09 文案合同返回（保留通用 `service-unavailable`）——经检查现有 502 文案已合规，本子任务无新代码

- [x] 3. 嵌入式预填客户端（F-3 / 需求 2）
  - [x] 3.1 在 `src/components/setup/backend-setup-page.tsx` 改动：`embeddedHealthy===true` 时在 fetch 回调末尾自动调 `applyEmbeddedDefaults()` 一次（用 useEffect 监听 `embeddedHealthy`）；仍保留「使用内置默认地址」手动按钮
  - [x] 3.2 在 `src/components/dashboard/settings/backend-tab.tsx` 改动：`initialFields` 对 `config?.[name]?.internal` 为空且 `embedded.healthy?.[name]===true` 的槽位填 `EMBEDDED_DEFAULTS[name]`；input 旁渲染 Badge「嵌入式探测」；保存仍只提交非空槽（现有语义）
  - [x] 3.3 在 `src/components/setup/backend-setup-page.tsx` 改造 setup token 传递：新 fetch 走 `Authorization: Bearer <token>` 头；保留 `?token=` 一轮兼容；服务端 `verifySetupToken` 改为先 header 后 query

- [x] 4. 对话优先默认表面（F-5 / 需求 3）
  - [x] 4.1 在 `src/components/dashboard/use-active-section.ts` 改动：`resolveInitialSection()` 最终回退从 `'overview'` 改为 `'chat'`（hash 与 localStorage 优先保持）
  - [x] 4.2 在 `src/components/dashboard/agent-teams-dashboard.tsx` 改动：`countMap` 增加 `chat` = `useRoomMetaStore` 中 `unreadCount>0` 的房间个数 + `useInviteStore.pendingCount()`；现有 workers/teams/managers 计数保持
  - [x] 4.3 在 `src/components/dashboard/sections/hitl-inbox-card.tsx` 改动：新增「待接受的 Matrix 邀请」计数展示（`useInviteStore.pendingCount()`）；点击邀请行 `takePendingInbox()`（渲染期原子消费）+ `setActiveSection('chat')`；空确认+空暂停但有邀请时卡片仍渲染

- [x] 5. 邀请存储与 ingest（F-4 / F-6 / 需求 4）
  - [x] 5.1 新建 `src/lib/matrix-invite-store.ts`：zustand。`invites: Record<roomId, Invite>`；`upsert(invite)` / `dropByRoomId(roomId)` / `pendingCount()` / `takePendingInbox()`（原子消费）
  - [x] 5.2 在 `src/lib/matrix-api.ts` 改动：`MatrixSyncResponse.rooms.invite` 类型从 `Record<string, unknown>` 收窄为 `Record<string, { invite_state?: { events?: MatrixEvent[] } }>`；新增 `joinRoom(homeserver, roomId)` / `leaveRoom(homeserver, roomId)` 两个 fetch 助手
  - [x] 5.3 在 `src/hooks/use-global-matrix-sync.ts` 改动：现有 `rooms.join` 循环旁增加 `rooms.invite` 与 `rooms.leave` ingest；invite→join 同 roomId 时 `dropByRoomId`；invite→leave 同 roomId 且本地无加入成功记录时 `dropByRoomId`
  - [x] 5.4 在 `src/components/dashboard/sections/chat/chat-room-sidebar.tsx` 改动：顶部渲染 `InviteInbox`（每行：房间名 + 邀请者本地名 + 接受/拒绝按钮）；按钮调 `/api/matrix/rooms/[roomId]/join|leave`；服务端返回 4xx 时展示 `errcode` 摘要且保持邀请可见

- [x] 6. join/leave 代理路由（F-6 / 需求 4.5-4.10）
  - [x] 6.1 新建 `src/app/api/matrix/rooms/[roomId]/join/route.ts`：`POST` 路由；`getMatrixHomeserver(request)` 复用 `validateHomeserverUrl({ requireAllowlist: true })`；`getAccessToken(request)` 仅 header；参数形状校验 `^!` 或 `^#[A-Za-z0-9._=/-]+:[A-Za-z0-9.-]+$`；上游 `POST {hs}/_matrix/client/v3/join/{encodeURIComponent(roomId)}`，空 JSON 体；成功则 `appendAuditEvent({ action: 'matrix.invite.accept' })`；形状不匹配返回 400 `{ error: 'invalid-room-id' }`；allowlist 失败 400 `{ error: 'homeserver-not-allowed' }`；上游超时 504 `{ error: 'join-failed' }`
  - [x] 6.2 新建 `src/app/api/matrix/rooms/[roomId]/leave/route.ts`：与 join 同骨架；上游 `POST {hs}/_matrix/client/v3/rooms/{encodeURIComponent(roomId)}/leave`；成功 audit `matrix.invite.reject`

- [x] 7. 检查点 - F-1～F-6 跑通回归
  - 跳过原因：本机无 `node_modules`，无法本地跑 tsc/eslint/vitest；按用户决策按代码层判定已通过，用户装依赖后由用户发起回归

- [x] 8. 审计与日志脱敏（横切 / 需求 5）
  - [x] 8.1 在 join/leave 路由审计写入：actor / actor_level 走现有 `x-agentteams-user` 头（middleware 已注入）；`source_ip` 遵守 `AGENTTEAMS_TRUST_PROXY`（沿用现有 `proxy-helper.ts` 模式）
  - [x] 8.2 在 `src/lib/dashboard-session.ts` / `backend-config.ts` 复查启动指纹与 4xx 响应体：完整 `DASHBOARD_SESSION_SECRET`、Matrix access token、Controller SA token 不进入任何响应体；`console.error` 启动指纹行只打后 4 位（setup token 启动行是唯一允许完整门禁的例外）

- [x] 9. 文档与 CHANGELOG 同步
  - [x] 9.1 在 `CHANGELOG.md` 的 Dashboard `v1.2.4.9` 段落补：嵌入式密钥自动落盘 / 后端预填 / 对话优先 default / 邀请 inbox
  - [x] 9.2 在 `.monkeycode/docs/模块/部署与交付.md`（Agent 内部）补：默认镜像 `v1.2.4.9`、卷 `/data/agentteams-dashboard`、session secret 自动生成、setup token 行为不变
  - [x] 9.3 在 `.monkeycode/docs/模块/Dashboard.md` 与 `.monkeycode/docs/专有概念/部署模式.md` 同步：默认主表面 `chat`、`countMap.chat` 公式、`nav-items.ts` 三组权威、Standalone vs Shared 子节