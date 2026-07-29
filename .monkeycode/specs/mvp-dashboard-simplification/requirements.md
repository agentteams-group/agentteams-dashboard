# MVP Dashboard 精简需求

## 引言

本功能将 AgentTeams Dashboard 收敛为面向日常资源管理的最小可用产品。功能覆盖团队成员输入、一级导航、资源操作后的状态呈现、可配置能力筛选和总览运行信息。

## 术语表

- **MVP 导航**：面向日常操作显示的总览、资源管理、聊天和文档入口集合。
- **资源操作**：对 Worker、Team、Manager 和 Human 发起的创建、更新、删除或生命周期请求。
- **已接受状态**：Controller 已成功接受资源操作请求的状态。
- **已生效状态**：资源查询返回的数据已反映资源操作预期结果的状态。
- **运行信息卡片**：总览中展示仓库、版本和进程运行时长的卡片。
- **Dashboard 版本**：运行中 Dashboard 构建的 `package.json` 版本。
- **AgentTeams 版本**：Controller `/api/v1/version` 返回的运行版本。

## 需求

### 需求 1：团队成员输入

**用户故事：** 作为操作员，我希望使用中文或英文逗号输入多个 Worker 名称，以便快速组建团队。

#### 验收标准

1. WHEN 操作员在团队创建表单输入英文逗号，Dashboard SHALL 将每个非空名称写入 `workerNames`。
2. WHEN 操作员在团队创建表单输入中文逗号，Dashboard SHALL 将每个非空名称写入 `workerNames`。
3. WHEN 操作员输入连续分隔符或分隔符相邻的空白字符，Dashboard SHALL 忽略空名称。
4. WHEN Dashboard 将 `workerNames` 呈现回团队创建表单，Dashboard SHALL 使用英文逗号和单个空格分隔名称。

### 需求 2：MVP 一级导航

**用户故事：** 作为操作员，我希望侧边栏只显示日常管理所需入口，以便快速进入资源操作页面。

#### 验收标准

1. Dashboard SHALL 将总览、Workers、团队、Managers、Humans、Matrix 聊天和文档呈现为侧边栏一级入口。
2. Dashboard SHALL 在 MVP 导航中呈现总览、Workers、团队、Managers、Humans、Matrix 聊天和文档七个入口。
3. WHEN 操作员访问历史分组哈希或已隐藏模块哈希，Dashboard SHALL 激活总览。
4. WHEN 操作员在移动端打开侧边栏，Dashboard SHALL 呈现与桌面端相同的七个一级入口。

### 需求 3：资源操作状态与刷新

**用户故事：** 作为操作员，我希望在资源操作后看到请求接受和状态生效的进度，以便准确判断后续操作时机。

#### 验收标准

1. WHEN Dashboard 接受 Worker、Team、Manager 或 Human 的创建、更新或删除响应，Dashboard SHALL 刷新对应资源列表和集群状态查询。
2. WHEN Dashboard 发起 Worker 唤醒、休眠或就绪请求，Dashboard SHALL 在请求期间禁用对应操作入口并展示进行中状态。
3. WHEN Controller 已接受异步调谐请求，Dashboard SHALL 将资源状态显示为等待生效，直至轮询查询返回目标状态或请求失败。
4. IF 资源在 60 秒内未返回目标状态，Dashboard SHALL 显示仍在等待生效的状态和最近一次查询时间。
5. WHEN 资源查询返回目标状态，Dashboard SHALL 移除等待生效状态并展示已生效状态。

### 需求 4：保留模块的可配置能力

**用户故事：** 作为操作员，我希望每个保留模块仅展示可由 Dashboard 保存并由运行时消费的配置，以便配置界面与实际行为一致。

#### 验收标准

1. Dashboard SHALL 对 Workers、团队、Managers、Humans 和 Matrix 聊天的每项表单字段定义对应的 Controller 或 Matrix 写入接口。
2. WHEN 表单字段缺少写入接口或运行时消费路径，Dashboard SHALL 从 MVP 界面移除该字段及其说明。
3. WHEN Dashboard 读取资源详情，Dashboard SHALL 仅展示当前保留模块支持保存的配置字段和运行时状态字段。
4. Dashboard SHALL 将 AI 网关、平台、治理和基础设施配置入口从 MVP 导航中移除。

### 需求 5：总览运行信息

**用户故事：** 作为操作员，我希望在总览查看运行组件的仓库、版本和运行时长，以便确认当前环境的构建来源与运行状态。

#### 验收标准

1. Dashboard SHALL 在总览中展示 AgentTeams 仓库地址和 AgentTeams 版本。
2. Dashboard SHALL 在总览中展示 Dashboard 仓库地址和 Dashboard 版本。
3. Dashboard SHALL 在总览中展示 Dashboard 进程运行时长。
4. Dashboard SHALL 将 AgentTeams Controller 运行时长呈现为接口未提供，直至 Controller 提供受认证的运行时长字段。
5. WHEN 任一运行信息数据源暂时不可用，Dashboard SHALL 为对应字段展示未知状态和刷新操作。
6. Dashboard SHALL 每 60 秒刷新运行信息卡片中的动态字段。

## 待确认决策

Dashboard 进程运行时长由服务端启动时间计算，部署容器重启后从当前进程重新计时。AgentTeams Controller 当前版本接口不提供运行时长，MVP 将字段标记为接口未提供。
