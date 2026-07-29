# 资源删除锁定需求

## 引言

本功能在 Worker 和团队删除请求执行期间，将操作锁定状态直接呈现在对应资源上，避免并发修改正在删除的资源。

## 术语表

- **删除中资源**：已提交删除请求且仍出现在最近一次资源查询结果中的 Worker 或团队。
- **资源操作**：编辑、删除、生命周期操作、成员变更和拓扑操作。
- **详情操作**：打开 Worker 或团队详情对话框的只读操作。

## 需求

### 需求 1：Worker 删除锁定

**用户故事：** 作为操作员，我希望在 Worker 删除期间看到该 Worker 的独立状态，以便避免发起冲突操作。

#### 验收标准

1. WHEN 操作员确认删除 Worker，Dashboard SHALL 将该 Worker 标记为删除中。
2. WHILE Worker 处于删除中，Dashboard SHALL 禁用该 Worker 的选择、编辑、唤醒、休眠、就绪和删除操作。
3. WHILE Worker 处于删除中，Dashboard SHALL 保持该 Worker 的详情操作可用。
4. WHILE Worker 处于删除中，Dashboard SHALL 在 Worker 卡片或表格的独立状态区域呈现删除中状态。
5. WHEN Worker 不再出现在资源查询结果中，Dashboard SHALL 移除该 Worker 的删除中状态。
6. IF Worker 删除请求失败，Dashboard SHALL 移除该 Worker 的删除中状态。

### 需求 2：团队删除锁定

**用户故事：** 作为操作员，我希望在团队删除期间看到团队的独立状态，以便避免改变正在删除的成员关系。

#### 验收标准

1. WHEN 操作员确认删除团队，Dashboard SHALL 将该团队标记为删除中。
2. WHILE 团队处于删除中，Dashboard SHALL 禁用添加 Worker、查看拓扑、编辑和删除操作。
3. WHILE 团队处于删除中，Dashboard SHALL 保持团队详情操作可用。
4. WHILE 团队处于删除中，Dashboard SHALL 在团队卡片或表格的独立状态区域呈现删除中状态。
5. WHEN 团队不再出现在资源查询结果中，Dashboard SHALL 移除该团队的删除中状态。
6. IF 团队删除请求失败，Dashboard SHALL 移除该团队的删除中状态。

### 需求 3：删除可见性

**用户故事：** 作为操作员，我希望删除中的资源保留在列表中，以便理解当前资源状态。

#### 验收标准

1. WHILE Worker 删除请求处于执行中，Dashboard SHALL 保留 Worker 在当前列表中。
2. Dashboard SHALL 将删除中状态呈现在资源内容区域或独立表格列中。
