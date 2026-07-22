<div align="center">
  <img src="public/agentteams-logo.svg" alt="AgentTeams Logo" width="110" />

  # AgentTeams Dashboard

  **A lightweight web console for managing AgentTeams clusters — Workers, Teams, Humans, Managers and infrastructure, with integrated Matrix chat.**

  [English](./README.md) | [简体中文](./README.zh-CN.md)

  [![Build Dashboard Image](https://github.com/agentteams-group/agentteams-dashboard/actions/workflows/build.yml/badge.svg)](https://github.com/agentteams-group/agentteams-dashboard/actions/workflows/build.yml)
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

The Dashboard integrates with the [AgentTeams](https://github.com/agentscope-ai/AgentTeams) installer via patch files under `install/patches/`. When the patches are applied to the AgentTeams source tree, the Dashboard becomes an optional step in `agentteams-install.sh` — the interactive installer will prompt whether to install it, and the container is automatically started alongside the Controller/Manager.

- **Default version**: `v1.0.0` (configurable via `AGENTTEAMS_DASHBOARD_VERSION`)
- **Default port**: `13000`, bound to `127.0.0.1` (set `AGENTTEAMS_LOCAL_ONLY=0` to expose on `0.0.0.0`)
- **Available versions**: tagged at https://github.com/agentteams-group/agentteams-dashboard/tags

You can also install the Dashboard standalone against an already-running AgentTeams cluster:

```bash
# Linux / macOS — standalone install
bash install/agentteams-dashboard.sh

# Windows — PowerShell install
install/agentteams-dashboard.ps1

# Uninstall
bash install/agentteams-dashboard.sh uninstall
```

After installation visit `http://127.0.0.1:13000/`.

#### Integration environment variables

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENTTEAMS_DASHBOARD` | Enable Dashboard installation (`1` = install, `0` = skip) | `1` |
| `AGENTTEAMS_PORT_DASHBOARD` | Host port mapped to the Dashboard container | `13000` |
| `AGENTTEAMS_DASHBOARD_VERSION` | Dashboard image tag | `v1.0.0` |
| `AGENTTEAMS_DASHBOARD_IMAGE` | Full Dashboard image reference | `${AGENTTEAMS_REGISTRY}/agentteams/agentteams-dashboard:${AGENTTEAMS_DASHBOARD_VERSION}` |

Non-interactive install example:

```bash
AGENTTEAMS_DASHBOARD=1 AGENTTEAMS_PORT_DASHBOARD=13000 AGENTTEAMS_DASHBOARD_VERSION=v1.0.0 \
  bash agentteams-install.sh --non-interactive
```

See [`install/AGENTTEAMS_PATCH.md`](install/AGENTTEAMS_PATCH.md) for detailed integration notes (patch contents, Makefile targets, verification).

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
# Pull and run the pre-built image
docker run -d -p 13000:3000 \
  --name agentteams-dashboard \
  -e AGENTTEAMS_CONTROLLER_URL=http://host.docker.internal:8090 \
  -e NEXT_PUBLIC_MATRIX_API_URL=http://host.docker.internal:6167 \
  ghcr.io/agentteams-group/agentteams-dashboard:v1.0.0

# Or build from source
docker build -t ghcr.io/agentteams-group/agentteams-dashboard:v1.0.0 .
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
