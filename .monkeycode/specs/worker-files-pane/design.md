# Worker 文件面板设计

Feature Name: worker-files-pane
Updated: 2026-08-08

## Description

聊天文件面板通过 Worker 文件 API 读取由服务端配置的对象存储 bucket。文件列表为空时，界面明确提示 Worker 文件尚未同步。`ChatRoom` 使用可拖拽分栏边界调整聊天和工作目录区域的宽度；会话列表可收起为展开按钮。

## Components and Interfaces

- `ChatRoom` 维护工作目录区域宽度和拖拽状态。
- 工作目录区域使用内联 `width` 呈现当前宽度。
- 分栏边界监听 pointer 事件，并将宽度限定为 256 至 600 像素。
- `ChatSection` 管理会话列表的折叠状态，并在折叠状态呈现展开控件。
- `GET /api/agentteams/workers/[name]/files/` 保持对象列表接口。

## Correctness Properties

- Worker 名与对象 key 继续由服务端校验。
- 工作目录区域宽度保持在 256 至 600 像素区间。
- 空对象列表、加载错误和有对象列表呈现互斥状态。

## Error Handling

- MinIO 查询失败时，Worker 文件接口返回泛化错误。
- 空对象列表提示 Worker 文件同步状态，不将空列表表示为请求错误。

## Test Strategy

- 保留 Worker 文件 API 的 bucket、前缀和 Worker 名验证测试。
- 添加工作目录分栏宽度范围、会话列表折叠状态与空列表提示的组件测试。

## References

[^1]: (src/components/dashboard/sections/chat/ChatRoom.tsx) - 聊天与工作目录分栏
[^2]: (src/app/api/agentteams/workers/[name]/files/route.ts) - Worker 文件列表接口
