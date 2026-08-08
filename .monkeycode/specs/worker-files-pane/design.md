# Worker 文件面板设计

Feature Name: worker-files-pane
Updated: 2026-08-08

## Description

聊天文件面板通过 Worker 文件 API 读取由服务端配置的对象存储 bucket。文件列表为空时，界面明确提示 Worker 文件尚未同步。文件面板使用可拖拽分栏边界调整列表和预览区域的宽度。

## Components and Interfaces

- `WorkerFilesPanel` 维护当前分栏宽度和拖拽状态。
- 文件列表区使用 `flex-basis` 呈现当前宽度。
- 分栏边界监听 pointer 事件，并将宽度限定为容器宽度的 25% 至 75%。
- `GET /api/agentteams/workers/[name]/files/` 保持对象列表接口。

## Correctness Properties

- Worker 名与对象 key 继续由服务端校验。
- 文件分栏宽度保持在 25% 至 75% 区间。
- 空对象列表、加载错误和有对象列表呈现互斥状态。

## Error Handling

- MinIO 查询失败时，Worker 文件接口返回泛化错误。
- 空对象列表提示 Worker 文件同步状态，不将空列表表示为请求错误。

## Test Strategy

- 保留 Worker 文件 API 的 bucket、前缀和 Worker 名验证测试。
- 添加文件分栏宽度范围与空列表提示的组件测试。

## References

[^1]: (src/components/dashboard/sections/chat/views/worker-files-panel.tsx) - 聊天文件面板
[^2]: (src/app/api/agentteams/workers/[name]/files/route.ts) - Worker 文件列表接口
