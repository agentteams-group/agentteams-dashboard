<div align="center">
  <img src="public/agentteams-logo.svg" alt="AgentTeams Logo" width="110" />

  # AgentTeams Dashboard

  **轻量级的 AgentTeams 集群 Web 管理面板 —— 可视化管理 Workers、Teams、Humans、Managers 与基础设施，并集成 Matrix 聊天能力。**

  [English](./README.md) | [简体中文](./README.zh-CN.md)

  [![Build Dashboard Image](https://github.com/higress-group/TaDashboard/actions/workflows/build.yml/badge.svg)](https://github.com/higress-group/TaDashboard/actions/workflows/build.yml)
  [![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
  [![React](https://img.shields.io/badge/React-19-149eca?logo=react)](https://react.dev/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
  [![Docker](https://img.shields.io/badge/Docker-ready-2496ed?logo=docker&logoColor=white)](./Dockerfile)
</div>

---

## ✨ 简介

AgentTeams Dashboard 是一个基于 **Next.js** 的 Web 界面，用于可视化管理 [AgentTeams](https://github.com/agentscope-ai/AgentTeams) 集群中的 Worker、Team、Human、Manager 等资源，内置 Matrix 聊天、拓扑视图与 RBAC/审计工具。既可以独立部署，也可以通过一行脚本嵌入到已有的 AgentTeams 安装中。

## 🚀 功能模块

| 模块 | 说明 |
|------|------|
| **Overview** | 全局概览：活跃 Worker、Team、Matrix 房间数、资源状态 |
| **Workers** | Worker 全生命周期管理：查看、唤醒、休眠、确保就绪、删除 |
| **Teams** | Team 管理：成员、关联 Worker、Human、详情弹窗 |
| **Humans** | Human 资源 CRUD：卡片/表格视图、权限级别、房间关联 |
| **Managers** | Manager 管理：模型配置、欢迎消息、协调团队/Worker |
| **K8s** | Kubernetes CRD 资源卡片展示、YAML/JSON 预览 |
| **Infrastructure** | 基础设施状态：Controller、Matrix、各组件健康度 |
| **Chat** | Matrix 聊天集成：房间列表、成员、富消息渲染（A2UI） |
| **Security** | 权限矩阵、访问控制、安全策略展示 |
| **Skills** | Skill/MCP 资源管理 |
| **Architecture** | 架构图与组件关系说明 |

## 🛠 技术栈

- **框架**：Next.js 16 + React 19 + TypeScript 5
- **样式**：Tailwind CSS v4 + shadcn/ui
- **状态管理**：Zustand + TanStack Query
- **运行时**：Node.js 20+
- **部署**：Docker，Next.js standalone 输出

## 📦 快速开始

### 作为 AgentTeams 组件安装（推荐）

如果你已安装 [AgentTeams](https://github.com/agentscope-ai/AgentTeams)，可以一键添加 Dashboard：

```bash
# 安装
bash install/agentteams-dashboard.sh

# 卸载
bash install/agentteams-dashboard.sh uninstall
```

默认端口 `13000`，安装后访问 `http://127.0.0.1:13000/`。

详细集成说明见 [`install/AGENTTEAMS_PATCH.md`](install/AGENTTEAMS_PATCH.md)。

### 独立运行

```bash
# 安装依赖
npm install

# 配置环境变量
cp .env.example .env
# 编辑 .env 设置 AGENTTEAMS_CONTROLLER_URL 和 NEXT_PUBLIC_MATRIX_API_URL

# 开发模式
npm run dev

# 生产构建
npm run build
npm start
```

### Docker 构建

```bash
docker build -t agentteams-dashboard:latest .
docker run -p 3000:3000 \
  -e AGENTTEAMS_CONTROLLER_URL=http://host.docker.internal:8090 \
  -e NEXT_PUBLIC_MATRIX_API_URL=http://host.docker.internal:6167 \
  agentteams-dashboard:latest
```

## ⚙️ 环境变量

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `AGENTTEAMS_CONTROLLER_URL` | AgentTeams Controller 地址（服务端代理用） | `http://agentteams-controller:8090` |
| `NEXT_PUBLIC_AGENTTEAMS_CONTROLLER_URL` | 浏览器端 Controller URL（可选） | — |
| `NEXT_PUBLIC_MATRIX_API_URL` | Matrix Homeserver 地址 | — |
| `MATRIX_HOMESERVER_ALLOWLIST` | Matrix 代理允许的 homeserver 主机名（逗号分隔，设置后排他生效） | — |
| `AGENTTEAMS_AUTH_TOKEN` | Controller 认证 Token | — |
| `AGENTTEAMS_AUTH_TOKEN_FILE` | Token 文件路径（支持轮转） | — |
| `DATABASE_URL` | SQLite 数据库路径 | `file:./db/dashboard.db` |
| `NEXT_PUBLIC_BASE_PATH` | URL 基础路径（嵌入部署时用） | `/dashboard` |

## 🏗 核心设计

前端不直接访问 AgentTeams Controller 或 Matrix Homeserver，所有请求都经过 Next.js API 路由代理层：

```
┌──────────────┐      ┌───────────────────────────┐      ┌────────────────────────┐
│   Browser    │─────▶│  Next.js API Routes       │─────▶│ AgentTeams Controller  │
│  (React UI)  │◀─────│  /api/agentteams/*        │◀─────│ (Workers/Teams/...)    │
└──────────────┘      │  /api/matrix/*            │      └────────────────────────┘
                      └────────────┬──────────────┘
                                   │
                                   ▼
                      ┌───────────────────────────┐
                      │   Matrix Homeserver       │
                      └───────────────────────────┘
```

- `proxy-helper.ts` 负责请求转发、认证头注入、超时与错误处理。
- **认证**：Dashboard 在 k3s 中通过 projected ServiceAccount Token 访问 Controller；Token 每次请求时重新读取，支持短时效 Token 自动轮转。
- **安全**：Matrix 访问 Token 由前端传入；homeserver 代理执行严格的主机名白名单，并拦截内网地址（SSRF 防护）。

## 📁 项目结构

```
├── src/
│   ├── app/
│   │   ├── api/              # 代理 API（agentteams + matrix）
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── dashboard/        # 面板业务组件
│   │   │   └── sections/     # 各功能区域
│   │   ├── ui/               # shadcn/ui 基础组件
│   │   ├── auth/             # 登录组件
│   │   └── setup/            # 初始化向导
│   ├── hooks/                # TanStack Query Hooks
│   └── lib/                  # 工具函数、API 客户端、Store
├── install/                  # AgentTeams 集成安装脚本
├── public/                   # 静态资源
├── Dockerfile
├── Makefile                  # 多架构 Docker 构建/推送
├── next.config.ts
├── vitest.config.ts
└── package.json
```

## 📜 可用脚本

| 脚本 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器（端口 3000） |
| `npm run build` | 构建 standalone 产物 |
| `npm start` | 启动生产服务器 |
| `npm run lint` | ESLint 检查 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm test` | 运行 vitest 测试套件 |

## 🧪 质量保障

- **单元测试**：vitest + Testing Library（150+ 用例，`npm test`）
- **代码规范**：ESLint 零问题（`npm run lint`）
- **类型安全**：strict TypeScript（`npm run typecheck`）
- **可复现构建**：`npm ci` + lockfile，多架构 Docker 镜像（`make help`）

## 🤝 相关仓库

- [AgentTeams](https://github.com/agentscope-ai/AgentTeams) — 多智能体协作运行时
- [AgentTeams Controller](https://github.com/higress-group/agentteams) — Controller

## 📄 许可证

本项目属于 higress-group，具体许可证请参考仓库根目录授权文件。
