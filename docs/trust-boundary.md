# 信任边界与端到端加密决断

> 这份文档回答三件事：聊天数据在链路的哪几跳是明文、凭据在谁手里；本产品在端到端加密（E2EE）上的立场是什么；运营者据此要做什么。读完你应该能判断自己的部署能不能放敏感协作内容，以及加密房间「消息不见了」时该往哪儿查。文中每条实现事实都带代码路径，可直接去查。

## 1. 决断

**本控制台不提供也不承诺端到端加密。**

原因一句话：Matrix 侧是手写 REST 代理——19 个路由（`src/app/api/matrix/**`）加一个客户端封装（`src/lib/matrix-api.ts`），把浏览器请求原样转发给 homeserver，`package.json` 里没有 olm / libolm / matrix-js-sdk 任何依赖。事件 `content` 从 homeserver 到浏览器全程是明文 JSON，中间的服务端代理进程同样读得到。补 E2EE 等于引入完整 SDK + 设备信任校验 + megolm 密钥备份与恢复，不是「加个开关」的量级。

这个取舍在优化方案里定案：`out/agentteams-dashboard-optimization-plan-v3.md` B-5（P1），省下的预算换给房间内容检索（B-1，已落地）与通知跳转（C-1）。会话侧的能力弹层已把这条写成用户看得见的一句话（`src/lib/matrix-capabilities.ts` 的 `encryption` 项），措辞与本文一致。

## 2. 信任边界表

两条链路都经过 Next.js 服务端：

```text
浏览器（React UI）
  ├─ /api/matrix/**      聊天：sync / messages / send / search / media …   → Matrix homeserver（Synapse 或 Tuwunel）
  └─ /api/agentteams/**  治理：Worker / Team / Human CR / 任务 / 审计       → AgentTeams Controller
```

| 环节 | 这一跳承载什么 | 谁能读到 | 凭据在哪 | 代码 |
| --- | --- | --- | --- | --- |
| 浏览器 → 控制台服务端（聊天面） | 明文消息正文（`m.room.message` 的 `body` / `formatted_body`）、发送者 MXID、房间 ID、检索关键词，以及 `Authorization: Bearer <matrix token>` | 本机浏览器进程，以及同机上任何能读 localStorage 的人；本机网络栈；若走 http，则是路径上所有能看到流量的人 | Matrix access token 由浏览器持有并每次带上，服务端不保存它 | `src/lib/matrix-store.ts`（zustand persist 到 localStorage）、`src/app/api/matrix/proxy-helper.ts`（`getAccessToken` 只认 Authorization 头，不接受 query 传 token） |
| 控制台服务端 → homeserver | 同一份明文，原样透传 | 跑 dashboard 的那个 Node 进程（请求体和响应体都读得到）；服务端主机上的 root，或任何能读该进程内存的人；反向代理与网关日志（记不记 body 见 §7） | 仍是调用方那个 token，代理不注入自己的凭据；目标 homeserver 必须过允许列表，所以 token 不会被中继到运维未批准的主机（SEC-05） | `src/app/api/matrix/proxy-helper.ts`（`proxyToMatrix`）、`src/lib/homeserver-allowlist.ts` |
| homeserver（Synapse / Tuwunel） | 该服务器可见的全部房间的全部事件明文，含历史；开了索引时另有一份全文索引（§4） | homeserver 管理员，以及数据库与文件系统权限范围内的任何人。拿到库就等于拿到全部聊天原文——E2EE 是唯一能挡住这一层的机制，本产品不用它，所以这一层对本控制台的使用者是敞开的 | homeserver 自身的账号库与事件库 | 不在本仓 |
| 加密房间里的 `m.encrypted` 事件 | 密文与 `algorithm` / `sender_key` / `session_id` | 读不出内容：homeserver 存密文，本控制台不识别也不解密（§5） | 无——没有密钥管理 | 无相关代码（§5 给出核实方式） |
| 浏览器 → 控制台服务端 → AgentTeams Controller（治理面） | Worker / Team / Human CR、任务、干预与配置变更 | Controller 按其自身权限处理；中间的控制台服务端读得到请求体 | **Shared 模式**：Controller 凭据（admin SA token，或 L2 用户自己的 Matrix token）只存在服务端内存会话表，浏览器只拿到签名 HttpOnly cookie，里面只有 sid 与用户名；**Stateless 模式**（`DASHBOARD_STATELESS=1`）相反，浏览器的 bearer 就是凭据 | `src/lib/dashboard-session.ts`、`src/app/api/agentteams/proxy-helper.ts`（注释写明「有服务端凭据时绝不信任浏览器传来的 Authorization 头」）、`src/middleware.ts` |
| 服务端磁盘上的审计日志 | 治理动作与 HITL 生命周期事件（字段见 §6） | 能读 `logs/audit.log.jsonl` 的人（路径可用 `AGENTTEAMS_AUDIT_LOG_PATH` 覆盖） | 不涉及 | `src/lib/audit-log.ts`、`src/app/api/agentteams/hitl/audit/route.ts` |
| 媒体文件 | 图片与文件正文，经 `/api/matrix/media/**` 转发 homeserver 的 media repo | 拿到该 media URL 的任何人 | token 可选：`<img>` / `<video>` 发不出 Authorization 头，这条路由依赖 media ID 不可猜（Matrix 的 capability-URL 模型） | `src/app/api/matrix/media/[...path]/route.ts` |

读表时容易漏掉的两点：

- **聊天附件的保护强度低于消息正文**：media 靠 ID 不可猜，不额外绑定会话身份。
- **`/api/matrix/*` 不在 dashboard 会话门禁内**：`src/middleware.ts` 的 matcher 只覆盖 `/api/agentteams/*`。聊天代理的授权凭据就是调用方持有的 Matrix token——谁拿到这个 token，谁就能读该用户可读的全部房间。双轨登录（Shared 模式）下服务端会代做一次 Matrix 密码登录，并把返回的 `access_token` 交给浏览器（`src/app/api/auth/login/route.ts` 的 `tryMatrixLogin` → `src/lib/matrix-store.ts` 的 `setMatrixAuth`），所以聊天 token 最终仍落在浏览器里。

登录这一步另有一句：`POST /api/matrix/login` 把用户名与密码原文转发到 `{homeserver}/_matrix/client/v3/login`，服务端不缓存密码；这条链路的保密性取决于传输层（§3）。

## 3. 传输层不在这张表里

上表说的是「哪个进程能看到什么」。这些数据在网络上是否加密，完全取决于运维的 TLS 配置：浏览器 ↔ 控制台、控制台 ↔ homeserver、控制台 ↔ Controller 任何一跳走内网 http，token 与正文在那一段链路上就是明文。相关开关：`DASHBOARD_COOKIE_SECURE=1` 才会给 session cookie 加 `Secure`（`src/lib/dashboard-session.ts` 的 `sessionCookieHeader`）。

## 4. 房间内容检索（B-1）与这个决断是同一件事的两面

检索链路：客户端 → `GET /api/matrix/search` → 上游 `/_matrix/client/v3/search`。filter JSON 在服务端拼装（`src/lib/matrix-search.ts` 的 `buildRoomSearchFilter`），客户端只允许传 `search_term` / `room_id` / `limit` 三个参数，`search_term` 截到 256 字符（`src/app/api/matrix/search/route.ts`）。

两处新增的明文留存要写清：

1. **消息正文被 homeserver 的全文索引持久化一份**（Synapse 的 `search_indexing_enabled`，默认开启）。这是事件库之外的第二份明文副本；删除消息后索引何时清理取决于 homeserver 自身实现，本控制台不控制——待运营者按自己的部署确认。
2. **搜索关键词出现在上游请求的 query string 里**：`buildSearchProxyPath` 用 `URLSearchParams` 把含 `search_terms` 的 filter 拼成 `?filter=...`。凡是记录完整请求路径的 homeserver 访问日志，都会留下关键词原文。

能全文搜历史消息的服务端，必然存着可读的明文。选了这个检索能力，就等于再次确认放弃 E2EE。

降级路径不产生新的服务端明文副本：homeserver 没开索引时返回错误码而不是空结果，客户端识别后退回「只搜当前会话已加载消息」并在 UI 标注覆盖范围（`src/lib/matrix-search.ts` 的 `detectSearchUnsupported`、`searchInLoadedMessages`）。

## 5. 加密房间在当前控制台的实际表现

先给结论：**开了加密的房间，在这里看起来是「没有新消息」，而且不会报错。**

实现事实（都可自行复核）：

- 全仓 `src/` 里搜 `m.room.encryption` / `m.encrypted` / `olm` / `megolm` / `decryption` 没有任何命中（唯一沾 `encryption` 字样的是 `src/lib/channel-field-templates.ts` 里的渠道配置开关字段，与 Matrix E2EE 无关）。
- 消息时间线与装配只接受 `m.room.message`：`src/hooks/use-matrix.ts`（`/sync` 合并与单事件解析两处 `event.type !== 'm.room.message'` 就跳过）、`src/lib/chat-ir/assemble.ts`（两处同样的类型闸门）、`src/lib/matrix-search.ts` 的 `SEARCHABLE_TYPES`。
- 所以 `m.encrypted` 事件被**静默丢弃**：不进消息流、不进检索、不产生任何提示。房间名与成员来自 state 事件，照常显示——这正是让人困惑的地方：房间是正常打开的，只是再也没有内容。

这不是 homeserver 的兼容性问题，是本控制台没有解密能力（§1）。会话侧栏底部的能力弹层已把这条写给使用者看（`src/lib/matrix-capabilities.ts` 的 `encryption` 项），措辞与本文一致。

运营者要在两个做法里选一个，本仓不替你拍板：

1. **限制开启加密**：在 homeserver 侧收紧成员下发 `m.room.encryption` 的权限（具体配置项随 Synapse / Tuwunel 版本不同，不在本仓范围），让协作房间根本无法被加密。
2. **接受不可读**：不改服务端配置，但在协作规范里写明「用于 AgentTeams 协作的房间不开加密」，并承认这类房间在本控制台读不出来。

无论选哪个，都不要把「加密房间」当作可选的安全增强来介绍——在这个版本里它的效果是内容消失。

## 6. 既然不靠 E2EE，实际存在的控制是什么

| 控制 | 它挡住什么 | 代码 |
| --- | --- | --- |
| homeserver 允许列表（SEC-05） | token 与消息被中继到运维未批准的主机 | `src/lib/homeserver-allowlist.ts`；无状态部署下没配 `MATRIX_HOMESERVER_ALLOWLIST` 时登录直接被拒（`src/app/api/matrix/static-login/route.ts`） |
| Controller 凭据留在服务端（Shared 模式） | 治理面凭据落进浏览器 | `src/lib/dashboard-session.ts`、`src/app/api/agentteams/proxy-helper.ts` |
| RBAC 拦截 + 审计落盘 | 「谁在什么时候动了什么」事后可查 | `src/lib/audit-log.ts`（字段 `actor,actor_level,entity_type,entity_name,action,details,severity,id,timestamp`，路径 `AGENTTEAMS_AUDIT_LOG_PATH`，10MB 轮转）、`logs/audit.log.jsonl` |
| HITL 干预留痕 | 人的每次回答有据可查 | `src/app/api/agentteams/hitl/audit/route.ts`（`details` 存 question / answer 原文）、`src/lib/hitl-audit.ts` |
| 导出面脱敏 | 对外导出诊断与回放时少带一次 PII | `src/app/api/agentteams/debug-log/redact.ts`（`redactPii` / `redactJsonStrings`），调用方仅 debug-log 与 `src/app/api/agentteams/replay/export/route.ts` |

审计这一面要读清三条限制，不然会高估它：

1. **干预问答原文入库且不过脱敏**——磁盘上那份 `audit.log.jsonl` 是明文，里面可能有密钥、内部地址、用户输入。文件权限按此设置。
2. **写入是 fire-and-forget**：客户端发审计失败不阻塞业务，所以审计日志不是全量记录，不能当合规账本用。
3. **`actor` 在会话不可用时会兜底取调用方自报值**（`hitl/audit/route.ts`：`actor === 'unknown' && body.actor`），无状态部署下这一列只是线索，不是可信身份。

## 7. 不承诺什么

逐条写死，避免被理解成「配置一下就有了」：

- **端到端加密**：没有，也不计划做（§1）。
- **前向保密与密钥撤销**：没有 megolm 会话轮转的概念，也没有撤销机制——历史消息一旦上游可读就永远可读。
- **设备信任与交叉签名**：控制台不处理 device keys，无法校验「这个 MXID 真的是那台设备」。
- **密钥备份与恢复**：不适用，因为不持有密钥体系。
- **服务端不可见**：控制台服务端进程与 homeserver 都读得到聊天正文（§2）。
- **审计完整性**：见 §6 的三条限制。
- **附件访问控制**：media 依赖 ID 不可猜，不绑定会话身份（§2）。
- **检索不留副本**：全文索引与 query string 各留一份（§4）。

## 8. 待运营者确认清单

这份文档能写到「实现事实」为止，下面几项取决于部署，只有你自己能确认：

- [ ] homeserver 的 `search_indexing_enabled` 现状，以及关掉后本控制台的检索降级是否被使用者理解（会话侧栏「能力」弹层会显示实测结论）。
- [ ] 删除消息后，事件库与全文索引的实际留存期（本控制台不控制这一点）。
- [ ] 反向代理 / 网关是否记录请求体与 `Authorization` 头；记了就是聊天原文与 token 的第二份明文副本。
- [ ] 浏览器 ↔ 控制台、控制台 ↔ homeserver、控制台 ↔ Controller 三跳是否都是 HTTPS；`DASHBOARD_COOKIE_SECURE` 是否已设为 1。
- [ ] `MATRIX_HOMESERVER_ALLOWLIST` 的实际内容，以及是否允许使用者自行填入任意 homeserver。
- [ ] `logs/audit.log.jsonl`（或 `AGENTTEAMS_AUDIT_LOG_PATH` 指向的位置）的文件权限与留存策略。
- [ ] §5 的两个做法选哪个，并把结论写进团队自己的协作规范。
