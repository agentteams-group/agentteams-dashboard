# Server-side RBAC + Audit — Task List

- [x] 1. 新增 `src/lib/audit-log.ts`：JSONL append + 10 MB rotate + 路径配置（环境变量 `AGENTTEAMS_AUDIT_LOG_PATH`，默认 `${cwd}/logs/audit.log.jsonl`）。导出 `appendAuditEvent(input)` 与 `listAuditEvents(query)`，单测覆盖 rotate 与并发追加
- [x] 2. 扩展 `src/lib/api-auth.ts` 的 `validateHigressSession`：从 `/v1/consumers` 响应提取 `name`/`level`，返回 `{ valid, user }`；缓存结构兼容（增加 `user` 字段）。同步更新所有调用点（plugins/route、plugins/[id]/route、higress/access）解构 `.valid`
- [x] 3. `src/middleware.ts`：在 401 检查通过后，通过 `NextResponse.next({ request: { headers: ... } })` 注入 `x-agentteams-user` / `x-agentteams-user-level`
- [x] 4. `src/app/api/agentteams/proxy-helper.ts`：在 auth-token 注入后增加白名单头 `x-agentteams-user` / `x-agentteams-user-level` 透传给 Controller
- [x] 5. 新增 `src/lib/server-auth.ts`：从 NextRequest 读取用户头 → 构造 `HumanResponse` → 调用 rbac-engine `checkPermission`；导出 `enforceServerSideRbac(req, action, resourceType, resourceName)`（无身份头时默认放行，由 middleware 网关决定）
- [x] 6. 改造写操作路由（worker create/update/delete/wake/sleep/ensure-ready，team create/update/delete，manager create/update/delete，human create/update/delete）：在调用 Controller 前调用 `enforceServerSideRbac`，403 时通过 server-auth 内部审计写入 warning 事件
- [x] 7. 新增 `src/app/api/agentteams/audit/route.ts`：POST 写入（仅 admin 内部，受 middleware 保护）、GET 列表（分页 + 时间 + entity 过滤，admin-only）
- [x] 8. `src/lib/audit-store.ts`：把 `auditMutation` 扩展为同时写本地 store 与服务端 `/api/agentteams/audit` POST（失败仅 warn）。hooks 层无改动
- [x] 9. 测试：audit-log 6 例、server-auth 5 例、audit API route 5 例、worker route RBAC 3 例；access.test.ts 与 plugins/route.test.ts mock 适配新 SessionValidation 形状
- [x] 10. typecheck + lint + 全量 134 文件 1188 用例通过；CHANGELOG Unreleased 记录

## 范围外（后续 PR）

- skills / storage / projects / gateway / debug-log / wen-tian / mcps / models/probe / packages / setup / presign 等写路由暂未加 RBAC，按 Controller 侧权限执行
- audit GET 暂无前端 viewer；按 spec 路线图规划