# Dashboard 一键收集调试日志 — 技术方案

> 版本：v1.0 · 日期：2026-08-08
> 对标工具：AgentTeams 主仓库 `scripts/export-debug-log.py`
> 落地仓库：`agentteams-group/agentteams-dashboard`

---

## 1. 背景与目标

### 1.1 原脚本分析

AgentTeams 主仓库提供了独立 Python 脚本 `scripts/export-debug-log.py`，用于故障排查时一键导出调试材料。其核心能力：

| 收集器 | 数据源 | 采集方式 | 输出 |
|---|---|---|---|
| Matrix 消息 | Tuwunel Homeserver | 读 `~/agentteams-manager.env` 取 Manager/Admin 密码登录 Matrix，遍历 joined_rooms 分页拉取 `/messages` | `matrix-messages/<Room>_<roomid>.jsonl` |
| Agent 会话 | 各容器内 session 文件 | `docker exec` 探测 OpenClaw / Hermes / CoPaw 三种 runtime 的 session 目录，按时间过滤后 cat 出来 | `agent-sessions/<容器>/<session>.jsonl` |
| 容器诊断 | Docker Engine | `docker ps/inspect/logs --since` | `container-logs/<容器>.log + .state.json` |
| PII 脱敏 | 全部产出 | 20 条正则（身份证/手机号/邮箱/银行卡/IP/各类 API Key/Bearer/secret KV/Matrix token 等） | 默认开启，`--no-redact` 关闭 |
| 汇总 | — | — | `summary.txt`，落盘 `debug-log/<时间戳>/` |

### 1.2 痛点与目标

原脚本的使用门槛：**必须在宿主机上执行**，依赖本地 `docker` CLI、Python 环境、以及 env 文件里的明文凭证。对于只装了 Dashboard 的排查者（尤其是远程支持场景）并不友好。

**目标**：在 Dashboard 内实现同等能力的「一键收集日志」功能 —— 浏览器点一下按钮，后端完成采集、脱敏、打包，直接下载 ZIP。

```
浏览器设置对话框 → [一键收集并下载] → agentteams-debug-log-<时间戳>.zip
├── summary.txt
├── matrix-messages/<RoomName>_<roomid>.jsonl   （已登录 Matrix 时）
├── agent-sessions/<container>/<session>.jsonl
└── container-logs/<container>.log / .state.json
```

---

## 2. 关键技术调研：Dashboard 容器里如何拿到这些数据？

Dashboard 是跑在容器里的 Next.js 应用，没有 docker CLI、没有宿主机 env 文件。调研发现两条既有通道可以完全覆盖原脚本的数据源，**无需任何新权限、新挂载、新依赖**：

### 2.1 容器数据 → Controller 内置 Docker API 反向代理

`agentteams-controller/internal/proxy/proxy.go` 的安全模型：

- **GET/HEAD 全放行**（只读）：`/containers/json`（列表）、`/containers/{name}/json`（inspect）、`/containers/{name}/logs`（日志）；
- **POST 白名单**含 `containers/{name}/exec` + `exec/{id}/start`：即 **docker exec 可用**，等价于原脚本的 `docker exec`；
- POST/DELETE 的写操作另有镜像白名单、禁 bind mount、禁特权等校验，与本功能无关但说明通道是安全收敛的。

Dashboard 侧已有成功先例：[logs/[component]/route.ts](../src/app/api/agentteams/logs/%5Bcomponent%5D/route.ts) 就是通过 `GET {controller}/docker/v1.41/containers/{name}/logs` 拉日志的，鉴权复用 `getControllerUrl()` + `getAuthToken()`（SA token 每请求重读，支持轮转）。

### 2.2 Matrix 消息 → 浏览器已有登录态

Dashboard 的 Chat 模块要求用户登录 Matrix，`matrix-store`（zustand persist）持有 `homeserver + accessToken`。现有 `/api/matrix/*` 路由的约定是：token 只走 `Authorization: Bearer` 头（不进 query/body，避免泄露进访问日志），homeserver 经 `validateHomeserverUrl()`（hostname 白名单 + 私网 SSRF 拦截）校验。**本功能完整复用这套约定**，server 端用该 token 直连 homeserver 拉消息——与原脚本"用 Manager 账号登录"不同，改用"当前用户自己的身份"，权限语义反而更准确（只能导出自己有权限看的房间）。

### 2.3 打包 → 复用已有依赖 fflate

`package.json` 已依赖 `fflate`（前端 worker 文件打包在用）。`zipSync` 在 Node 端同样可用，内存中直接产出 ZIP，零新依赖。

---

## 3. 总体架构

```
┌─────────────────┐   POST /api/agentteams/debug-log/   ┌──────────────────────────────┐
│  浏览器          │ ───────────────────────────────────▶│  Next.js Route Handler        │
│  设置·日志收集    │   body: {range, redact, filters}    │  app/api/agentteams/debug-log/ │
│  页签            │   header: Authorization (Matrix)    │                              │
└─────────────────┘                                     └───────┬──────────────┬─────────┘
         │                                                      │              │
         │  agentteams-debug-log-<ts>.zip (fflate zipSync)      │              │
         │◀─────────────────────────────────────────────────────│              │
         │                                      ┌───────────────▼───┐   ┌──────▼─────────┐
         │                                      │ AgentTeams         │   │ Matrix          │
         │                                      │ Controller         │   │ Homeserver      │
         │                                      │ /docker/v1.41/*    │   │ /_matrix/client │
         │                                      │  ├ containers/json │   │ /v3/joined_rooms│
         │                                      │  ├ .../logs        │   │ /rooms/*/msgs   │
         │                                      │  ├ .../json        │   └─────────────────┘
         │                                      │  └ exec + start    │  （homeserver 白名单
         │                                      └────────────────────┘   + SSRF 校验）
         │ 收集器全部 try/catch 隔离，部分失败写入 summary.txt Notes，不中断整体导出
```

与原脚本能力对照：

| 能力 | export-debug-log.py | Dashboard 实现 | 差异说明 |
|---|---|---|---|
| 容器列表/状态/日志 | 本地 `docker ps/inspect/logs` | Controller Docker 代理 GET | 等价 |
| Agent 会话采集 | 本地 `docker exec` | 代理 exec create + start | 等价，且做了批量化优化（见 §4.3） |
| Matrix 消息 | env 文件拿 Manager/Admin 密码登录 | 浏览器当前用户 token | 身份语义更准确；未登录则降级跳过 |
| PII 脱敏 | 20 条正则 | 同规则 TypeScript 移植 | 规则一致，修正 1 处原脚本缺陷（见 §4.1） |
| 产物 | 落盘 `debug-log/<ts>/` 目录 | 内存打包 ZIP 下载 | 不落盘、无状态 |
| 时间范围 | `--range 10m/1h/1d` | 同名参数 | 一致 |
| 容器/房间过滤 | `--container/--room` | 同名参数 | 一致 |

---

## 4. 实现细节（变更清单）

### 新增文件

```
src/app/api/agentteams/debug-log/
├── route.ts          # 主路由：编排三大收集器 + summary + zipSync 打包
├── docker.ts         # Controller Docker 代理客户端（list/inspect/logs/exec + 流解复用）
├── matrix.ts         # Matrix 消息导出（joined_rooms + 分页 messages + 事件格式化）
├── sessions.ts       # Agent 会话导出（三 runtime 探测 + 按时间过滤）
├── redact.ts         # PII 脱敏（20 条规则）
└── redact.test.ts    # 脱敏单测 16 例

src/components/dashboard/settings/
└── debug-log-tab.tsx # 「日志收集」页签 UI
```

### 修改文件

```
src/components/dashboard/settings-dialog.tsx   # 设置对话框新增第三个页签（连接 / AI 诊断 / 日志收集）
```

### 4.1 `redact.ts` — PII 脱敏

- 完整移植原脚本 20 条正则：身份证、手机号、邮箱、银行卡、IP、阿里云 AK/SK、AWS AK、OpenAI/Anthropic/DashScope/DeepSeek Key、Bearer、通用 secret KV、Matrix token、32+ 位 hex、护照、SSN；
- `keepPrefix` 规则（Bearer / SECRET_KV / ALIYUN_SK）保留 key 名只遮蔽值，替换为 `$1****`；
- `redactJsonStrings()` 递归处理 JSON：字段名命中 `SECRET_FIELD_PATTERN`（password/token/apiKey…）直接置 `****`，否则递归脱敏字符串；
- **修正原脚本一处缺陷**：Python 版 `ALIYUN_SK` 正则的捕获组 1 是 secret 值本身，`\1****` 替换会把 secret 原文保留下来（key 名反而被吃掉）。TS 版调整为捕获组 1 = key 名前缀，真正遮蔽密钥值；
- JS 正则全面支持 lookbehind/lookahead（Node 20+），语义与 Python 一致。

### 4.2 `docker.ts` — Docker 代理客户端

- 统一 `dockerFetch()`：`{controller}/docker/v1.41<path>`，携带 SA token，默认 60s 超时（exec 30s）；
- `demuxDockerStream()`：解析 Docker raw stream 的 8 字节帧头（`[stream][3×pad][uint32 BE len][payload]`），logs 与 exec 输出都是这种帧格式；兼容 TTY 无帧头的兜底；
- `listAgentTeamsContainers()`：`GET /containers/json?all=1&filters={"name":["agentteams-"]}`；
- `inspectContainer()`：提取 `State / Config.Image / RestartCount` 组成诊断 JSON；
- `getContainerLogs()`：`--timestamps --since <epoch秒>` 对齐原脚本；
- `dockerExec()`：`POST /containers/{name}/exec`（`sh -c`）→ `POST /exec/{id}/start`（Detach=false）→ 解复用 stdout。

### 4.3 `sessions.ts` — Agent 会话导出（核心复杂度）

忠实移植三种 runtime 的目录布局探测与过滤逻辑，并针对「exec 从本地进程调用变成 HTTP 往返」做了**批量化优化**：

- **runtime 探测（1 次 exec）**：原脚本是「读 `$AGENTTEAMS_WORKER_NAME` 一次 exec + 每个候选目录一次 `test -d`」，最多 8 次往返；TS 版把 worker 名读取 + 全部候选路径探测合成**一段 sh 脚本**一次执行，按优先级输出 `FOUND <dir>`，本地解析；未命中再走 `find / -maxdepth 7` 兜底（与原脚本一致）；
- **文件读取（1 次 exec）**：原脚本对每个 session 文件 `head -1` / `tail -1` / `cat` 三次 exec（先判时间再决定是否全量拉取）；TS 版改为 `for f in <dir>/*.jsonl; do echo MARKER; cat; done` **一次拉全量**，时间过滤（header 保留、事件按 `timestamp >= since` 过滤、整会话过期丢弃）全部在 server 端本地完成。单次 payload 变大但往返次数从 O(3N) 降到 O(1)，在 HTTP 通道下整体更快、逻辑更简单；
- **OpenClaw**：`.jsonl` 逐行解析，`type=="session"` 头始终保留；附带 `sessions.json` 索引；
- **CoPaw**：`find -name '*.json'`，解 `agent.memory.content`（turn→msg 两层结构），过滤后重组为「session 头 + message 事件」的 jsonl；
- **Hermes**：jsonl + `session_meta` 角色保留；附加 `state.db`（容器内有 python3 时用 sqlite3 导出最近 200 条）和 `logs/agent.log|errors.log|gateway.log`；
- 每个容器独立 try/catch，失败记入 errors 数组，最终写进 summary。

### 4.4 `route.ts` — 主路由

- `POST /api/agentteams/debug-log/`，`export const dynamic = 'force-dynamic'`、`maxDuration = 300`；
- 请求体：`{ range='1h', redact=true, container?, room?, messagesOnly?, homeserver? }`；`range` 解析规则与原脚本一致（`10m/1h/1d`…）；
- Matrix 凭证：`Authorization` 头取 token（沿用 `/api/matrix/*` 约定），homeserver 从 body 或 `?homeserver=` 取；**任一缺失则跳过 Matrix 导出并在 summary 注明**（降级而非报错）；
- 编排顺序：容器列表（两个收集器共用）→ 容器诊断（inspect + logs）→ Agent 会话 → Matrix 消息；每个收集器独立容错，异常全部收敛为 summary 里的 Notes；
- 产物：`summary.txt`（时间范围/脱敏状态/三路计数/Notes）+ 全部文件 `zipSync(level:6)`，响应头 `Content-Disposition: attachment; filename="agentteams-debug-log-<ts>.zip"`，`Cache-Control: no-store`。

### 4.5 前端 `debug-log-tab.tsx` + `settings-dialog.tsx`

- 设置对话框新增第三个页签「日志收集」（FileDown 图标），TabsList `grid-cols-2 → grid-cols-3`；
- 页签控件：时间范围 Select（10m/30m/1h/6h/1d）、容器过滤、房间过滤、PII 脱敏 Switch（默认开，带 ShieldCheck 说明）、Matrix 状态提示条（已登录 → 含房间消息；未登录 → 提示将跳过）；
- 点击「一键收集并下载」：`fetch(apiUrl('/api/agentteams/debug-log'))`（apiUrl 自动补 basePath + 尾斜杠，规避 trailingSlash 308 重定向丢 POST body 的问题）；已登录 Matrix 时自动带上 `Authorization` 头和 homeserver；
- 响应处理：非 2xx 解析 JSON error 弹 toast；成功则读 `content-disposition` 文件名，`URL.createObjectURL` + 隐形 `<a download>` 触发浏览器下载，toast 提示文件名；全程 loading 态（收集耗时可能数十秒）。

### 4.6 测试 `redact.test.ts`

16 个用例覆盖：各类正则的遮蔽、keepPrefix 规则的 key 保留、普通文本不误伤、JSON 递归脱敏、secret 字段名置空、数组顶层等边界。

---

## 5. 接口契约

```
POST /api/agentteams/debug-log/
Headers:
  Content-Type: application/json
  Authorization: Bearer <matrix-token>        # 可选；提供则导出 Matrix 消息
Body:
{
  "range": "1h",            # 10m|30m|1h|6h|1d，支持 N(m|min|h|hr|hour|d|day)
  "redact": true,           # 默认 true
  "container": "worker",    # 可选，子串过滤容器
  "room": "Worker",         # 可选，子串过滤房间名/ID
  "homeserver": "http://..."# 可选（也可走 ?homeserver=）
}
Response 200:
  Content-Type: application/zip
  Content-Disposition: attachment; filename="agentteams-debug-log-20260808-153000.zip"
Response 4xx: { "error": "..." }   # 参数错误
```

ZIP 内部结构：

```
summary.txt
matrix-messages/<RoomName>_<roomid>.jsonl
agent-sessions/<container>/<session>.jsonl [sessions.json | sessions-db.json | *.log]
container-logs/<container>.log
container-logs/<container>.state.json
```

---

## 6. 安全设计

1. **凭证零落盘**：Matrix token 仅在请求头中瞬时使用；Controller SA token 服务端每请求重读（支持轮转）；ZIP 全程内存组装，不写磁盘；
2. **SSRF 防护**：homeserver 复用 `validateHomeserverUrl()`（白名单 + 私网地址拦截）；controller 地址复用 `getControllerUrl()` 的 host 白名单；
3. **权限收敛**：Docker 侧只用到 controller 代理已放行的只读 GET + exec；Matrix 侧以当前登录用户身份导出，天然只能看到自己有权访问的房间；
4. **PII 默认脱敏**：20 条规则默认开启，用户显式关闭才产出原文；
5. **输入校验**：range 格式校验、容器/房间过滤仅作子串匹配、容器名经 Docker API 自身校验（代理层还有 `name` 字符白名单）。

## 7. 性能与可靠性

- **超时**：单 exec 30s、单 docker 请求 60s、单 Matrix 请求 30s、路由 `maxDuration=300`；
- **往返优化**：runtime 探测 8→1 次、session 读取 3N→1 次 exec；
- **降级策略**：Docker 代理不可达 / Matrix 未登录 / 单容器失败，均不阻断其他收集器，差异写入 `summary.txt` Notes；
- **资源**：ZIP 内存组装，1h 范围典型产物为数百 KB ~ 数 MB 级，风险可控；大时间范围 + 大集群场景建议后续做流式打包（见 §9）。

## 8. 验证结果

| 检查 | 结果 |
|---|---|
| `npm run typecheck` | 新增代码 0 错误（仅存量 `workers/[name]/files/route.test.ts` 3 处历史错误，与本次无关） |
| `npx eslint <变更文件>` | 0 错误 0 警告 |
| `vitest run src/app/api/agentteams/debug-log` | **16/16 通过** |
| `npm test` 全量 | 304/307 通过；3 个失败位于存量 `workers/[name]/skills/route.test.ts`（vitest fork worker 启动超时，Windows 环境问题，与本次变更无关） |
| `npm run build` | 生产构建通过（Next.js standalone 产物含新路由与页签） |

## 9. 已知限制与后续路线

1. **K8s/Helm 部署形态**：本功能依赖 Controller 的 Docker 代理，该代理面向 docker 单节点部署；k3s 形态下容器日志/会话需改走 Kubernetes API（`kubectl logs`/`exec` 等价物），可作为后续迭代（路由层已按收集器隔离，新增 K8s collector 即可）；
2. **Matrix 未登录时无消息导出**：可考虑支持服务端配置只读 bot 账号兜底；
3. **大产物流式化**：当前 `zipSync` 内存打包，后续可换 `fflate` 的 `Zip` 流式接口 + `Transfer-Encoding: chunked`；
4. **产物回传**：可增加「直接上传到 MinIO / 生成分享链接」选项，便于远程支持场景；
5. **采集进度**：当前为单次长请求 + loading，后续可拆分为「创建任务 → 轮询进度 → 下载」三段式。

---

## 附：使用方式

1. 打开 Dashboard → 右上角设置 → 「日志收集」页签；
2. 选择时间范围（默认最近 1 小时），按需填容器/房间过滤；
3. 保持 PII 脱敏开启（默认）；
4. 需要房间消息时先登录 Matrix（Chat 模块）；
5. 点击「一键收集并下载」，得到 `agentteams-debug-log-<时间戳>.zip`，附在 issue 中即可。
