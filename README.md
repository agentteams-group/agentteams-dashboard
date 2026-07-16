<div align="center">
  <img src="public/agentteams-logo.svg" alt="AgentTeams Logo" width="110" />

  # AgentTeams Dashboard

  **A lightweight web console for managing AgentTeams clusters — Workers, Teams, Humans, Managers and infrastructure, with integrated Matrix chat.**

  [English](./README.md) | [简体中文](./README.zh-CN.md)

  [![Build Dashboard Image](https://github.com/higress-group/TaDashboard/actions/workflows/build.yml/badge.svg)](https://github.com/higress-group/TaDashboard/actions/workflows/build.yml)
  [![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=next.js)](https://nextjs.org/)
  [![React](https://img.shields.io/badge/React-19-149eca?logo=react)](https://react.dev/)
  [![TypeScript](https://img.shields.io/badge/TypeScript-5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
  [![Tailwind CSS](https://img.shields.io/badge/Tailwind-v4-38bdf8?logo=tailwindcss&logoColor=white)](https://tailwindcss.com/)
  [![Docker](https://img.shields.io/badge/Docker-ready-2496ed?logo=docker&logoColor=white)](./Dockerfile)
</div>

---

## ✨ Overview

AgentTeams Dashboard is a **Next.js** web UI for visually managing [AgentTeams](https://github.com/agentscope-ai/AgentTeams) cluster resources — Workers, Teams, Humans and Managers — with built-in Matrix chat, topology views and RBAC/audit tooling. It can be deployed standalone or embedded into an existing AgentTeams installation with a one-line install script.

## 🚀 Features

| Module | Description |
|--------|-------------|
| **Overview** | Cluster at a glance: active Workers, Teams, Matrix rooms, resource status |
| **Workers** | Full lifecycle management: view, wake, sleep, ensure-ready, delete |
| **Teams** | Team management: members, linked Workers/Humans, detail dialogs |
| **Humans** | Human CRUD: card/table views, permission levels, room association |
| **Managers** | Manager management: model configuration, welcome messages, team coordination |
| **K8s** | Kubernetes CRD resource cards with YAML/JSON preview |
| **Infrastructure** | Infra health: Controller, Matrix and component status |
| **Chat** | Matrix chat integration: room list, members, rich message rendering (A2UI) |
| **Security** | Permission matrix, access control and security policy views |
| **Skills** | Skill / MCP resource management |
| **Architecture** | Architecture diagram and component relationships |

## 🛠 Tech Stack

- **Framework**: Next.js 16 + React 19 + TypeScript 5
- **Styling**: Tailwind CSS v4 + shadcn/ui
- **State**: Zustand + TanStack Query
- **Runtime**: Node.js 20+
- **Deployment**: Docker, Next.js standalone output

## 📦 Quick Start

### Install as an AgentTeams component (recommended)

If you already have [AgentTeams](https://github.com/agentscope-ai/AgentTeams) installed, add the Dashboard with one command:

```bash
# Install
bash install/agentteams-dashboard.sh

# Uninstall
bash install/agentteams-dashboard.sh uninstall
```

Default port is `13000` — visit `http://127.0.0.1:13000/` after installation.

See [`install/AGENTTEAMS_PATCH.md`](install/AGENTTEAMS_PATCH.md) for detailed integration notes.

### Run standalone

```bash
# Install dependencies
npm install

# Configure environment
cp .env.example .env
# Edit .env: set AGENTTEAMS_CONTROLLER_URL and NEXT_PUBLIC_MATRIX_API_URL

# Development
npm run dev

# Production
npm run build
npm start
```

### Docker

```bash
docker build -t agentteams-dashboard:latest .
docker run -p 3000:3000 \
  -e AGENTTEAMS_CONTROLLER_URL=http://host.docker.internal:8090 \
  -e NEXT_PUBLIC_MATRIX_API_URL=http://host.docker.internal:6167 \
  agentteams-dashboard:latest
```

## ⚙️ Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENTTEAMS_CONTROLLER_URL` | AgentTeams Controller endpoint (server-side proxy) | `http://agentteams-controller:8090` |
| `NEXT_PUBLIC_AGENTTEAMS_CONTROLLER_URL` | Browser-facing Controller URL (optional) | — |
| `NEXT_PUBLIC_MATRIX_API_URL` | Matrix Homeserver endpoint | — |
| `MATRIX_HOMESERVER_ALLOWLIST` | Comma-separated homeserver hostnames allowed through the Matrix proxy (exclusive once set) | — |
| `AGENTTEAMS_AUTH_TOKEN` | Controller auth token | — |
| `AGENTTEAMS_AUTH_TOKEN_FILE` | Token file path (supports rotation) | — |
| `DATABASE_URL` | SQLite database path | `file:./db/dashboard.db` |
| `NEXT_PUBLIC_BASE_PATH` | URL base path (embedded deployment) | `/dashboard` |

## 🏗 Architecture

The browser never talks to the AgentTeams Controller or the Matrix Homeserver directly — every request goes through the Next.js API route proxy layer:

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

- `proxy-helper.ts` handles request forwarding, auth header injection, timeouts and error normalization.
- **Auth**: in k3s, the Dashboard accesses the Controller with a projected ServiceAccount token. The token is re-read on every request, so short-lived token rotation works out of the box.
- **Security**: Matrix access tokens are passed from the frontend; the homeserver proxy enforces a strict hostname allowlist and blocks private-network targets (SSRF protection).

## 📁 Project Structure

```
├── src/
│   ├── app/
│   │   ├── api/              # Proxy API routes (agentteams + matrix)
│   │   ├── globals.css
│   │   ├── layout.tsx
│   │   └── page.tsx
│   ├── components/
│   │   ├── dashboard/        # Dashboard business components
│   │   │   └── sections/     # Feature sections
│   │   ├── ui/               # shadcn/ui primitives
│   │   ├── auth/             # Login components
│   │   └── setup/            # Setup wizard
│   ├── hooks/                # TanStack Query hooks
│   └── lib/                  # Utilities, API client, stores
├── install/                  # AgentTeams integration install scripts
├── public/                   # Static assets
├── Dockerfile
├── Makefile                  # Multi-arch Docker build/push
├── next.config.ts
├── vitest.config.ts
└── package.json
```

## 📜 Scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start the dev server (port 3000) |
| `npm run build` | Build the standalone production bundle |
| `npm start` | Start the production server |
| `npm run lint` | ESLint checks |
| `npm run typecheck` | TypeScript type checking |
| `npm test` | Run the vitest test suite |

## 🧪 Quality

- **Unit tests** with vitest + Testing Library (150+ tests, `npm test`)
- **Lint-clean** ESLint configuration (`npm run lint`)
- **Type-safe** with strict TypeScript (`npm run typecheck`)
- **Reproducible builds** via `npm ci` + lockfile and multi-arch Docker images (`make help`)

## 🤝 Related Projects

- [AgentTeams](https://github.com/agentscope-ai/AgentTeams) — multi-agent collaboration runtime
- [AgentTeams Controller](https://github.com/higress-group/agentteams) — the Controller

## 📄 License

This project belongs to higress-group. Please refer to the license file in the repository root for details.
