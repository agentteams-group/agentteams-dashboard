# Server-side RBAC + Audit

## 背景

Dashboard 当前有两个治理层面的薄弱环节：
- **审计**：src/lib/audit-store.ts 是 zustand + localStorage，仅 src/hooks/use-agentteams-mutations.ts 的 14 处调用。被用户/浏览器清空即失忆，多端不可见。
- **RBAC**：src/lib/rbac-engine.ts 写完了完整的规则引擎，但服务端 middleware（src/middleware.ts:55）只校验"是否有 Higress session"，rbac-engine 仅在 human-detail-dialog 等 UI 展示。任何人持有效 session 即可执行任意管理操作。

## 目标

1. 审计事件落到服务端 JSONL 文件，客户端 store 降级为展示缓存；任何被服务端接收的 mutation 在服务端也写一条不可篡改的记录。
2. middleware 解析 Higress session 背后的用户名/角色，注入到请求头；mutation API 在写 Controller 之前按 rbac-engine 做服务端细粒度校验。
3. 不引入新数据库依赖。

## 非目标

- 不改 Higress Console 的会话机制。
- 不引入 SQLite / better-sqlite3 / Prisma / Drizzle 等任何服务端 DB。
- 不动 rbac-engine 的规则语义（保持现有 3 级权限 + custom rules 模型）。
- 不改客户端 mutation 流程的用户体验（toast / store 行为不变）。

## 设计

### 服务端审计
- 路径：`/var/log/agentteams/audit.log.jsonl`（可通过 `AGENTTEAMS_AUDIT_LOG_PATH` 覆盖，默认 `${cwd}/logs/audit.log.jsonl`）
- 格式：每行一个 JSON 对象，含 `id`（ULID/时间戳+随机）、`timestamp`、`actor`、`actor_level`、`entity_type`、`entity_name`、`action`、`details`、`severity`、`source_ip`
- rotate：文件达到 10 MB 或当日 0 点触发 rotate，旧的归档为 `audit.log.YYYY-MM-DD.jsonl`（最多保留 30 份）
- 写入用 `fs.appendFile` 单次 syscall，避免高频 mutation 触发 IO 抖动；rotate 用单独子进程异步执行
- 新增 `src/app/api/agentteams/audit/route.ts`：
  - POST 写入（由 mutation 流程异步触发，失败仅记 warn 不阻塞业务）
  - GET 列表（分页 + 时间范围 + entity 过滤；仅 admin 级别可见）
  - 路径仍受 middleware 保护

### 用户身份注入
- 扩展 `src/lib/api-auth.ts` 的 `validateHigressSession`：在调用 `/v1/consumers` 时同时取回 `name` 与 `level`，返回 `{ valid, user: { name, level } }`
- `src/middleware.ts` 在通过验证后通过 `x-agentteams-user` 与 `x-agentteams-user-level` 两个请求头把身份传下去
- proxy-helper.ts 增加白名单头部 `x-agentteams-user*`，透传给 Controller（写操作可被 Controller 审计关联）
- 新增 `src/lib/server-auth.ts`：从请求头读取身份并构造 `HumanResponse` 供 rbac-engine 使用

### 服务端 RBAC
- 在 src/lib/rbac-engine.ts 导出 `permissionToActionMap`：把 mutation 路由映射到 Permission 枚举
- `src/app/api/agentteams/` 下写操作路由（workers POST/DELETE/wake/sleep/ensure-ready，teams POST/DELETE，managers POST/DELETE）在调用 Controller 前调用 `enforceServerSideRbac(req, action, resourceType, resourceName)`；失败返回 403 并自动写一条 severity=warning 的审计
- 读操作（GET）暂不强制 RBAC（防止与既有 Human 列表语义冲突；后续按需收紧）

## 验收

- [ ] `validateHigressSession` 返回 `{ valid, user }`，缓存结构兼容
- [ ] middleware 通过验证时写入 `x-agentteams-user` / `x-agentteams-user-level` 请求头
- [ ] proxy-helper 透传上述头给 Controller（白名单方式）
- [ ] 写操作路由（workers/teams/managers POST/DELETE/wake/sleep/ensure-ready）在写 Controller 前调用服务端 RBAC；403 响应包含可读原因
- [ ] 每次 mutation 成功/失败均向服务端审计 POST 一条 JSONL 记录
- [ ] 服务端审计 JSONL 文件按 10 MB 自动 rotate，保留 30 份
- [ ] `GET /api/agentteams/audit` 仅 admin 级别可见
- [ ] typecheck / lint / test 全绿；现有 14 处 auditMutation 调用保持客户端 UX 不变
- [ ] CHANGELOG Unreleased 记录