# 需求文档：Workbench 对齐（Coding CLI 管理面）

## 概述

对照 agentteams-qwenpaw-workbench 0.5.0-beta.15 与 AgentTeams Controller coding-cli 管理面，在 Dashboard 补齐 Worker 编码 CLI 的探测、配置、异步安装，以及六场景 preset。聊天、工作流、产物、知识库、技能中心、频道、内置工具、运行时配置沿用 Dashboard 现有区块。宿主技能、L0-L3 自检、PawApp 窗口、内外网地址故障转移由 workbench 插件继续承担。

本期在 Controller 端点尚未合入时先落地 404 占位；合入后同一面板自动点亮。

## 术语表

- **Dashboard**：本仓库 Next.js 控制台。
- **Controller**：AgentTeams Controller，提供 `/api/v1/workers/{name}/coding-cli*`。
- **Coding CLI**：Worker 容器内的编码代理命令行，本期白名单为 `qwen-code` 与 `opencode`。
- **探测（probe）**：查询各 CLI 是否已安装、版本号、鉴权是否已配置。
- **settings**：CLI 本地配置文件经 Controller 读出或合并写入的 JSON。
- **脱敏**：凭据形态键以 `{ "redacted": true, "has_value": true }` 返回，原始密钥留在 Controller 边界内。
- **哨兵**：写入值为 `***` 时保留磁盘上已有密钥。
- **安装任务**：Controller 侧有界异步 npm 安装或卸载，返回 202 与 `task_id`。
- **Preset**：Workbench 六场景 JSON 模板；自动写入仅覆盖 `settings.model.name`。
- **占位横幅**：上游返回 404 时的中性不可用提示，文案不含上游变更编号。
- **Worker 重建**：镜像升级或 spec 变更导致容器重建；CLI 二进制随临时层消失，settings 可保留在 agent home。

## 已确认决策

| 项 | 选择 |
| --- | --- |
| 范围 | 对齐 workbench 操作员工作流中 Dashboard 尚未覆盖的 Coding CLI 面，含六场景 preset |
| 上游策略 | 先落地 404 占位，端点可用后自动点亮 |
| CLI 白名单 | `qwen-code`、`opencode` |
| 数据面 | 消费 Controller `/api/v1/workers/{name}/coding-cli*` |
| 挂载点 | Worker 详情对话框内独立面板 |

## 用户故事

### US-1: 在 Worker 详情打开 Coding CLI 面板

**作为** 团队管理员，**我希望** 在 Worker 详情中看到编码 CLI 管理区，**以便** 与运行时配置、频道、工具同一处完成安装与鉴权。

#### 验收标准

1. WHEN 操作者打开某个 Worker 的详情对话框，Dashboard SHALL 渲染 Coding CLI 面板。
2. WHEN 操作者切换到另一个 Worker，Dashboard SHALL 以新 Worker 名重新挂载该面板并清空上一 Worker 的编辑态。
3. WHILE 面板首次加载探测结果，Dashboard SHALL 显示加载指示。

---

### US-2: 探测已安装 CLI

**作为** 团队管理员，**我希望** 看到该 Worker 上 `qwen-code` 与 `opencode` 的安装与鉴权状态，**以便** 判断能否委派编码任务。

#### 验收标准

1. WHEN 面板加载且 Controller 返回 200，Dashboard SHALL 展示白名单内每个 CLI 的安装状态、版本（若已安装）与鉴权是否已配置。
2. WHEN 某个白名单 CLI 未安装，Dashboard SHALL 提供安装入口。
3. WHEN 某个白名单 CLI 已安装，Dashboard SHALL 提供卸载入口与 settings 编辑入口。
4. IF 探测请求失败且状态码为 400、502 或 503，Dashboard SHALL 显示对应错误说明并保留重试入口。

---

### US-3: 读取脱敏后的 settings

**作为** 团队管理员，**我希望** 查看 CLI 配置且看不到原始密钥，**以便** 确认模型与鉴权是否配好。

#### 验收标准

1. WHEN 操作者打开某个已安装 CLI 的 settings，Dashboard SHALL 请求该 CLI 的 settings 并展示可编辑字段。
2. WHEN settings 响应中某凭据键标记为已脱敏且 `has_value` 为 true，Dashboard SHALL 以占位提示表示密钥已保存，输入框保持空白表示保留原值。
3. IF settings 文件尚不存在且 Controller 返回空对象，Dashboard SHALL 展示可新建的空表单。

---

### US-4: 合并写入 settings

**作为** 团队管理员，**我希望** 修改模型名或密钥后保存，**以便** CLI 使用新配置。

#### 验收标准

1. WHEN 操作者保存 settings，Dashboard SHALL 将改动字段提交给 Controller 做深度合并写入。
2. WHEN 操作者将密钥字段留空且该键原先已有值，Dashboard SHALL 提交哨兵 `***` 以保留原密钥。
3. IF Controller 因无原值可保留而拒绝哨兵（400），Dashboard SHALL 提示操作者填写真实密钥后再保存。
4. WHEN 保存成功，Dashboard SHALL 重新读取 settings 并展示保存成功反馈。

---

### US-5: 异步安装与卸载

**作为** 团队管理员，**我希望** 在 Worker 容器内安装或卸载指定 CLI，**以便** 启用或收回编码委派能力。

#### 验收标准

1. WHEN 操作者对白名单 CLI 发起安装，Dashboard SHALL 提交安装请求并接受 202 与 `task_id`。
2. WHEN 操作者对已安装 CLI 发起卸载，Dashboard SHALL 提交卸载请求并接受 202 与 `task_id`。
3. IF 同一 Worker 同一 CLI 已有进行中的安装任务，Dashboard SHALL 展示占用中说明（对应 409）。
4. IF 安装请求携带非法版本标签且 Controller 返回 400，Dashboard SHALL 展示校验失败说明。

---

### US-6: 安装进度与终态

**作为** 团队管理员，**我希望** 看到安装任务进度与结果，**以便** 知道何时可以探测或改 settings。

#### 验收标准

1. WHILE 安装任务状态为 running，Dashboard SHALL 按任务查询接口刷新进度。
2. WHEN 安装任务状态变为 done，Dashboard SHALL 重新探测该 Worker 的 CLI 列表。
3. WHEN 安装任务状态变为 failed，Dashboard SHALL 展示失败说明（含退出码或 stderr 摘要，若响应提供）。
4. IF 用其他 Worker 的路径查询本任务，Dashboard SHALL 按 Controller 返回的 404 展示任务不存在。

---

### US-7: 上游未合入时的占位

**作为** 操作者，**我希望** 在 Controller 尚无 coding-cli 端点时看到明确占位，**以便** 知道该能力将随 Controller 升级出现。

#### 验收标准

1. WHEN 探测或 settings 请求返回 404，Dashboard SHALL 显示占位横幅，文案说明该 Worker 的编码 CLI 管理暂不可用。
2. WHEN Dashboard 显示该占位，文案 SHALL 使用中性产品用语。
3. WHEN 随后同一请求返回 200，Dashboard SHALL 以探测结果替换占位横幅。

---

### US-8: 部署模式与运行时错误

**作为** 操作者，**我希望** 在 kube 模式或容器不可达时看到可理解的说明，**以便** 选择正确的处置。

#### 验收标准

1. WHEN Controller 返回 503，Dashboard SHALL 说明当前部署模式不支持容器内安装与配置（embedded 才可执行）。
2. WHEN Controller 返回 502，Dashboard SHALL 说明无法在该 Worker 容器内执行管理命令。
3. WHEN Worker 处于可管理运行时（含 qwenpaw、openclaw、coworker、deepseek-harness），Dashboard SHALL 展示同一套 Coding CLI 面板。

---

### US-9: 权限与范围

**作为** 平台，**我希望** 写操作受团队范围与角色约束，**以便** 与频道、runtime-config 同一套纪律。

#### 验收标准

1. WHEN 团队 Leader 打开本团队 Worker 的 Coding CLI 面板，Dashboard SHALL 允许查看探测与 settings。
2. WHEN 团队 Leader 尝试保存 settings 或发起安装，Dashboard SHALL 展示 Controller 返回的 403 说明。
3. WHEN 团队范围调用方访问其无权探测的 Worker，Dashboard SHALL 按 404 走占位或不可用态。
4. WHEN 具备 Worker 更新权限的调用方保存 settings 或安装，Dashboard 服务端 SHALL 在转发前执行与其他 Worker 写路由相同的 RBAC 校验。

---

### US-10: 固定路径白名单

**作为** 平台，**我希望** Dashboard 只转发约定的 coding-cli 路径，**以便** 代理面保持与频道矩阵相同的边界。

#### 验收标准

1. WHEN 浏览器请求探测，Dashboard SHALL 转发到 `GET /api/v1/workers/{name}/coding-cli`。
2. WHEN 浏览器请求某个 CLI 的 settings 读或写，Dashboard SHALL 仅在 CLI id 属于 `{qwen-code, opencode}` 时转发对应 GET 或 PUT。
3. WHEN 浏览器请求安装或查询任务，Dashboard SHALL 仅在 CLI id 属于白名单且路径为 `install` 或 `install/{task_id}` 时转发。
4. IF 路径段或 CLI id 超出白名单，Dashboard SHALL 返回 400。

---

### US-11: Worker 重建后的重装提示

**作为** 团队管理员，**我希望** 在容器重建后知道 CLI 需要重装，**以便** 避免委派时命令找不到。

#### 验收标准

1. WHEN 探测显示鉴权已配置且对应 CLI 未安装，Dashboard SHALL 提示操作者重新安装（settings 可能仍在，二进制已随容器层消失）。
2. WHEN 操作者完成重装且探测显示已安装，Dashboard SHALL 撤下该重装提示。

---

### US-12: 六场景 Preset

**作为** 团队管理员，**我希望** 一键套用鸿蒙 / Web / Android / iOS / 嵌入式 / 通用编码模板，**以便** 把 CLI 模型名对齐到场景约定。

#### 验收标准

1. WHEN Coding CLI 面板处于可写状态，Dashboard SHALL 提供六个 preset：`p-harmony`、`p-web`、`p-android`、`p-ios`、`p-embedded`、`p-gencode`。
2. WHEN 操作者应用某个 preset，Dashboard SHALL 仅把该模板的 `settings_patch`（`model.name`）合并写入当前选中 CLI 的 settings。
3. WHEN 应用 preset 成功，Dashboard SHALL 展示该模板的工具链建议、MCP 建议与产物目录约定，供操作者人工确认。
4. WHEN 操作者再应用另一个 preset，Dashboard SHALL 覆盖上一 preset 写入的 `model.name`，并保留非 preset 字段（含已有密钥）。

---

### US-13: Preset 建议清单需确认

**作为** 团队管理员，**我希望** 工具链与 MCP 只作为建议出现，**以便** 团队级 CR 变更仍由人确认。

#### 验收标准

1. WHEN Dashboard 展示 preset 建议清单，工具链与 MCP 项 SHALL 标记为需人工确认。
2. WHEN 操作者应用 preset，Dashboard SHALL 把写入范围限制在 settings 合并；Worker CR、env、MCP 绑定保持原状，直到操作者在既有编辑入口另行保存。

---

### US-14: 审计

**作为** 治理人员，**我希望** settings 写入与安装出现在既有审计通道，**以便** 追溯谁改了哪个 Worker 的 CLI。

#### 验收标准

1. WHEN Dashboard 转发 settings PUT 或 install POST，服务端 SHALL 走与其他 Worker 写代理相同的审计挂接。
2. WHEN Dashboard 转发探测 GET、settings GET 或安装任务 GET，服务端 SHALL 保持只读、不新增 mutation 审计条目。

---

## 非功能

1. WHILE 操作者使用 Dashboard，Coding CLI 面板的交互语言 SHALL 与 Worker 详情其他面板一致（中文界面）。
2. WHEN 编写本功能测试，测试 SHALL 覆盖：404 占位、白名单 400、RBAC 拒绝短路、探测 200 渲染、哨兵留空、安装 202 轮询到 done/failed、kube 503 文案、preset 只写 `model.name`。

## 参考

- workbench 0.5.0-beta.15：https://github.com/LUOSENGWA/agentteams-qwenpaw-workbench
- Controller coding-cli 契约：https://github.com/agentscope-ai/AgentTeams/pull/1360
- workbench preset：`frontend/src/presets/`（p-harmony / p-web / p-android / p-ios / p-embedded / p-gencode）
- Dashboard 代理先例：`src/app/api/agentteams/workers/[name]/channels/[...rest]/route.ts`、`runtime-config/route.ts`、`tools/route.ts`
- 挂载点：`src/components/dashboard/sections/workers/worker-detail-dialog.tsx`
