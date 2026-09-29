# 需求文档：线上版本热更新与任务看板切换修复

Feature Name: hot-update-nav-fix
Updated: 2026-09-29

## 介绍

两个交付物：

1. **线上版本热更新**：生产环境部署新镜像后，已打开的浏览器页面自动感知新版本并完成刷新——页面可见时提示用户手动刷新，页面处于后台时静默刷新。配套增加 chunk 加载失败自愈，覆盖「旧页面请求已被新部署清除的 chunk」这一热更新过渡期的必然故障。
2. **chat→任务看板首次点击无响应修复**：根因已确认为线上镜像落后于源码修复（单树渲染重构已于 09-26 落地，`agent-teams-dashboard.tsx:383-394` 注释原话记录了该症状）。本需求覆盖：新镜像发布与部署验收清单，以及两处防回归加固。

## 术语表

- **构建版本 (Build ID)**: `next build` 生成的唯一标识（standalone 产物 `.next/BUILD_ID`），同一次构建产出的所有实例共享同一值
- **版本探测**: 浏览器端周期性请求 dashboard 自身的构建版本接口，与本次页面加载时的基线比对
- **静默刷新**: 用户未注视页面（`document.hidden === true`）时自动执行整页 reload
- **Chunk 自愈**: 懒加载区块的动态 import 失败（典型原因：旧 chunk 已被新部署清除）时自动整页刷新一次
- **线上镜像**: `build.yml`（Publish Dashboard Image）构建并发布的 dashboard 容器镜像，仅在打 tag 或手动 workflow_dispatch 时发布

## 需求

### Requirement 1: dashboard 构建版本接口

**User Story:** AS 运维人员, I want dashboard 暴露自身构建版本, so that 浏览器端能判断当前页面是否落后于最新部署

#### Acceptance Criteria

1. The dashboard SHALL 提供只读接口 `GET /api/dashboard-build`，返回当前进程的构建版本标识（buildId）与构建产物信息
2. The 构建版本接口 SHALL 在进程生命周期内缓存读取结果，保证同一进程的响应值恒定
3. IF 构建版本标识读取失败, the 构建版本接口 SHALL 返回 `buildId: "unknown"` 并仅记录一次告警日志
4. The 构建版本接口 SHALL 免认证且响应体仅包含构建标识与时间戳（零敏感信息）

### Requirement 2: 浏览器端版本探测

**User Story:** AS 长时间挂机的操作者, I want 页面自动感知新版本, so that 我看到的永远是最新部署的功能

#### Acceptance Criteria

1. WHEN 页面完成首次渲染, the 客户端 SHALL 请求一次构建版本接口并将结果记为基线
2. WHILE 页面保持打开, the 客户端 SHALL 以 60 秒间隔周期性请求构建版本接口
3. IF 版本接口请求失败, the 客户端 SHALL 静默重试（指数退避至 10 分钟上限），页面行为与现状保持一致
4. WHEN 探测到的构建版本与基线不同, the 客户端 SHALL 按 Requirement 3 或 Requirement 4 执行刷新流程
5. WHILE 页面在后台被静默刷新后重新可见, the 客户端 SHALL 以新版本重新建立基线

### Requirement 3: 新版本提示（页面可见时）

**User Story:** AS 正在操作页面的用户, I want 收到新版本提示并自行决定刷新时机, so that 进行中的操作（输入消息、填表单）被打断的风险由我掌控

#### Acceptance Criteria

1. WHEN 探测到构建版本变化且 `document.hidden` 为 false, the 客户端 SHALL 展示常驻提示条，内容为「新版本已发布」并提供「立即刷新」操作
2. WHILE 用户正在聊天输入框输入且内容为空判断之外的场景（输入框聚焦）或任一对话框处于打开状态, the 提示条 SHALL 保持展示且客户端保持等待（由用户手动触发刷新）
3. WHEN 用户点击「立即刷新」, the 客户端 SHALL 执行整页刷新
4. WHILE 提示条已展示且用户忽略超过 30 分钟, the 客户端 SHALL 保留提示条并继续等待（零强制刷新）

### Requirement 4: 静默刷新（页面在后台）

**User Story:** AS 同时开多个看板页签的运维人员, I want 后台页签自动更新, so that 切回页签时无需手动刷新

#### Acceptance Criteria

1. WHEN 探测到构建版本变化且 `document.hidden` 为 true, the 客户端 SHALL 立即执行整页刷新（静默，无提示条）
2. WHEN 用户通过浏览器前进/后退或切换页签回到本页面, the 客户端 SHALL 展示刷新后的新版本页面

### Requirement 5: Chunk 加载失败自愈

**User Story:** AS 使用旧版本页面的用户, I want 点击新部署后已不存在的资源失败时页面自动恢复, so that 我可以继续工作

#### Acceptance Criteria

1. IF 任一懒加载区块的 chunk 请求失败且当前会话（sessionStorage 标记）尚未自愈过, the 客户端 SHALL 在 3 秒内自动整页刷新一次
2. IF 自愈刷新后再次发生 chunk 请求失败, the 客户端 SHALL 展示现有的区块错误边界卡片并维持现状（等待用户手动刷新或新版本探测触发）
3. The chunk 自愈 SHALL 在每次浏览器会话中最多执行一次自动刷新

### Requirement 6: chat→任务看板修复的部署验收

**User Story:** AS 报告该 bug 的操作者, I want 线上 chat 切任务看板首次点击立即生效, so that 看板操作符合直觉

#### Acceptance Criteria

1. WHEN 新镜像发布并部署完成, the 生产环境 SHALL 运行包含 09-26 单树渲染修复（45395a4 之后的 main 构建）的构建版本
2. WHEN 操作者从 chat 区块点击侧边栏「任务看板」, the 任务看板 SHALL 在 1 秒内呈现（骨架屏或内容均算呈现）
3. The 部署验收 SHALL 包含连续 10 次「chat→任务看板」首点验证且全部通过

### Requirement 7: 会话侧栏拖拽监听器清理（防回归加固）

**User Story:** AS 代码维护者, I want chat 会话侧栏拖拽中途切换区块时事件监听器被正确清理, so that 泄漏的 pointermove 监听器不会残留

#### Acceptance Criteria

1. WHEN chat 会话侧栏拖拽（resize）过程中组件被卸载, the 会话侧栏 SHALL 移除其注册在 window 上的全部 pointermove/pointerup 监听器
