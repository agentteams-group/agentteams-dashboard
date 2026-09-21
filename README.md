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
| **Chat** | Matrix workspaces: room and member navigation, virtualized timeline, threads, edits, rich runtime message rendering |
| **Security** | Permission matrix, access control and security policy views |
| **Skills** | Skill / MCP resource management |
| **Debug Log** | One-click debug log collection: bundled ZIP with container diagnostics, agent sessions and Matrix messages, PII-redacted by default |
| **WenTian (问天)** | Runtime diagnostic assistant: cluster health overview, AI-powered diagnosis with structured Markdown report (root cause analysis, impact assessment, remediation steps), log analysis with real-time SSE progress bar, all driven by the AgentTeams SRE expert prompt template |
| **Architecture** | Architecture diagram and component relationships |
| **Theming** | Built-in light / dark / high-contrast themes, a custom theme editor (30+ parameters) with JSON import/export, and enterprise `theme.config.json` injection |
| **Plugins** | Runtime plugin system: 5 extension points, dynamic loading, per-plugin error isolation, dev hot-reload, and a `create-dashboard-plugin` scaffold CLI |

## 🛠 Tech Stack

- **Framework**: Next.js 16 + React 19 + TypeScript 5
- **Styling**: Tailwind CSS v4 + shadcn/ui
- **State**: Zustand + TanStack Query
- **Runtime**: Node.js 20+
- **Deployment**: Docker, Next.js standalone output

## Matrix Chat

The chat workspace renders Matrix rooms with virtualized history, unread-aware scrolling, message actions, read receipts and on-demand thread panels. Root messages remain in the main timeline; `m.thread` replies are counted on their root and loaded in the thread panel.

Runtime messages are parsed from A2UI markers, AgentScope runtime `Message` repr bodies, `agentteams.workflow`, Tool Guard confirmations and legacy card formats. The UI renders Markdown, collapsible reasoning, tool-call, workflow, confirmation and A2UI blocks. Optional `org.agentteams.run` payloads are supported as a runtime-adapter compatibility format; the Dashboard also handles standard Matrix `m.replace` revisions for streaming updates.

## 🎨 Theming

The Dashboard ships three built-in themes (light, dark, high-contrast), follows the system preference, and persists the choice across reloads. A theme editor in *Settings → Appearance* exposes 10+ visual parameters (colors, radius, font size) with live preview and JSON import/export. Operators can roll out an enterprise theme via `theme.config.json` or environment variables. See [docs/theme-customization.md](docs/theme-customization.md) (English) and [docs/theme-customization.zh-CN.md](docs/theme-customization.zh-CN.md) (中文).

## 🧩 Plugins

Third parties can extend the Dashboard without forking it. The plugin system provides five extension points (sidebar menu, standalone page, dashboard widget, detail-panel block, toolbar button), runtime dynamic loading, per-plugin error isolation, isolated state, an event bus, and dev hot-reload. A scaffold CLI generates a ready-to-run plugin project:

```bash
node tools/create-dashboard-plugin/bin/cli.js my-plugin
cd my-plugin && npm install && npm run dev
# then install http://localhost:5173/plugin.json via Settings → Plugins
```

See [docs/plugin-development.md](docs/plugin-development.md) (English), [docs/plugin-development.zh-CN.md](docs/plugin-development.zh-CN.md) (中文) and the design doc [docs/plugin-system-design.md](docs/plugin-system-design.md).

## 📦 Quick Start

### Install as an AgentTeams component (recommended)

The Dashboard integrates with the [AgentTeams](https://github.com/agentscope-ai/AgentTeams) installer as an optional step in `agentteams-install.sh` (merged upstream via [PR #1075](https://github.com/agentscope-ai/AgentTeams/pull/1075)) — the interactive installer will prompt whether to install it, and the container is automatically started alongside the Controller/Manager. Further upstream changes are contributed through pull requests to the AgentTeams repository; the patch-based flow under `install/patches/` has been retired.

- **Current Dashboard release**: `v1.2.4.9` (release tag). The app version source of truth is `version` in `package.json` (`1.2.4.9`); release tags use a four-segment variant (`v1.2.4.9` = `1.2.4` + ninth hotfix)
- **Installer default**: `v1.2.2`; set `AGENTTEAMS_DASHBOARD_VERSION` to override
- **Default port**: `13000`, bound to `127.0.0.1` (set `AGENTTEAMS_LOCAL_ONLY=0` to expose on `0.0.0.0`)
- **Available versions**: tagged at https://github.com/agentteams-group/agentteams-dashboard/tags
- **Integration PR**: https://github.com/agentscope-ai/AgentTeams/pull/1075
- **Platform**: Linux/macOS (Bash installer) only. PowerShell support is planned.

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
| `AGENTTEAMS_DASHBOARD_VERSION` | Dashboard image tag (independent release) | `v1.2.2` |
| `AGENTTEAMS_DASHBOARD_IMAGE` | Full Dashboard image reference | `${AGENTTEAMS_REGISTRY}/agentteams/agentteams-dashboard:${AGENTTEAMS_DASHBOARD_VERSION}` |
| `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` | Higress Console URL for shared login (explicit config takes priority) | auto-detected |

**Key integration features**:
- Independent versioning — AgentTeams and Dashboard can release on different schedules
- Full env persistence — keep-all upgrades preserve all Dashboard settings
- Explicit URL priority — `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` overrides auto-detection
- Auto URL normalization — `http://` is prepended if protocol is missing
- CLI token polling — 30s retry with graceful fallback
- Legacy HiClaw compatibility — also reads `/var/run/hiclaw/cli-token`

Non-interactive install example:

```bash
AGENTTEAMS_DASHBOARD=1 AGENTTEAMS_PORT_DASHBOARD=13000 AGENTTEAMS_DASHBOARD_VERSION=v1.2.2 \
  bash agentteams-install.sh --non-interactive
```

See [`install/AGENTTEAMS_PATCH.md`](install/AGENTTEAMS_PATCH.md) for detailed integration notes (patch contents, Makefile targets, verification, and roadmap).

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

The same image serves every deployment form; the form is chosen by env flags
at `docker run` time.

**Standalone — one instance per user (default).** After `docker run`, open
the URL: the first-launch page collects the backend addresses (Controller /
Matrix / MinIO / Higress / SGLang, internal + external each), you save, and
the login page appears. Team members (L2) then log in with **their own
Matrix account and password only** — no tokens, no admin credentials.

```bash
docker run -d -p 13000:3000 \
  --name agentteams-dashboard \
  --restart unless-stopped \
  -v agentteams-dashboard-data:/data/agentteams-dashboard \
  -e DASHBOARD_SESSION_SECRET="$(openssl rand -hex 32)" \
  -e DASHBOARD_SETUP_TOKEN_ENFORCE=0 \
  ghcr.io/agentteams-group/agentteams-dashboard:<tag>
```

- `DASHBOARD_SESSION_SECRET` is **required** — login fails closed without
  it. Generate once and keep it stable across container rebuilds.
- `DASHBOARD_SETUP_TOKEN_ENFORCE=0` lets the installer skip the pre-login
  setup token (trusted-LAN deployments only; the startup log records the
  open state). Omit it to keep the pre-login token gate — the same token
  stays the owner gate for `?setup=1` reconfiguration until the volume is
  reset (it is not consumed by the first save).
- Team admins (L1) verify once more at login: the admin password (needs
  `AGENTTEAMS_AUTH_TOKEN` below) or a controller token pasted in the login
  form.
- Gateway Console features (model management, shared login) additionally
  need `-e AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS=<console-host>`
  (SSRF guard). **The installer auto-merges the hostname of a
  custom Console URL typed at the prompt into that allowlist** (union,
  never replacing operator entries); when configuring a custom Console
  URL via raw `docker run`, append the hostname yourself or admin
  login is rejected (the login page then reports a deployment
  configuration error, not a permission error).

**Shared — multiple users on one instance.** Add:

```bash
  -e DASHBOARD_SHARED_MODE=1 \
  -e DASHBOARD_SETUP_TOKEN="$(openssl rand -hex 16)" \
  -e AGENTTEAMS_AUTH_TOKEN=<controller cli-token>
```

Effects: only admin (L1) sessions may save the backend config (L2 save
returns 403); the setup token is read from env only and never written to the
volume — with no env token the pre-login setup path is closed (fail-closed;
set it so the `?setup=1` escape hatch works); every config write is audited
with actor + level + changed fields.
`AGENTTEAMS_AUTH_TOKEN` enables the L1 admin-password login path — without
it, L1 pastes the controller token at each login instead.

**Embedded** (installed by `install/agentteams-install.sh`): addresses come
from the surrounding AgentTeams topology; the first-launch page only appears
when nothing is configured.

To reconfigure at any time: login page → "Cannot log in? Backend setup"
(`?setup=1`).

```bash
# Or build from source
docker build -t agentteams-dashboard:local .
```

## ⚙️ Configuration

| Variable | Description | Default |
|----------|-------------|---------|
| `AGENTTEAMS_CONTROLLER_URL` | AgentTeams Controller endpoint (server-side proxy) | `http://agentteams-controller:8090` |
| `AGENTTEAMS_RESOURCE_PREFIX` | Docker resource prefix for Worker workspace file access; match the Controller setting (including the trailing hyphen) | `agentteams-` |
| `NEXT_PUBLIC_AGENTTEAMS_CONTROLLER_URL` | Browser-facing Controller URL (optional) | — |
| `NEXT_PUBLIC_MATRIX_API_URL` | Matrix Homeserver endpoint | — |
| `MATRIX_HOMESERVER_ALLOWLIST` | Comma-separated homeserver hostnames allowed through the Matrix proxy (exclusive once set). **Required for private-network / LAN deployments** — homeserver URLs on private ranges (e.g. `192.168.*`) are rejected by the SSRF guard by default and would break login and all Matrix traffic. **Mandatory in stateless mode** (`DASHBOARD_STATELESS=1`): static login and device revoke are rejected outright (403 `allowlist-not-configured`) when it is unset, and only operator-listed hosts ever receive credentials | — |
| `DASHBOARD_STATELESS` | `1` = stateless deployment mode: no server-side user sessions — the browser holds its own Matrix/Controller bearer token (localStorage) and presents it per request. See "Stateless deployment mode" below for the security model | unset (stateful) |
| `AGENTTEAMS_AUTH_TOKEN` | Controller auth token — enables the L1 admin-password login path and (with `DASHBOARD_SHARED_MODE=1`) is the only admin credential source | — |
| `AGENTTEAMS_AUTH_TOKEN_FILE` | Token file path (supports rotation) | — |
| `DASHBOARD_SESSION_SECRET` | HMAC secret for session cookies — **required** for login | — |
| `DASHBOARD_CONFIG_FILE` | Backend config file written by the first-launch setup page (file takes precedence over `AGENTTEAMS_*_URL` env) | `/data/agentteams-dashboard/config.json` |
| `DASHBOARD_SETUP_TOKEN` | Pre-login setup token. Unset = auto-generated and printed once to the log (standalone); in shared mode the env is the only source (absent = pre-login path closed, fail-closed) | — |
| `DASHBOARD_SETUP_TOKEN_ENFORCE` | `0` = pre-login config save needs no token (trusted LAN) | unset (gate enforced) |
| `DASHBOARD_SHARED_MODE` | `1` = multiple users share this instance (L1-only config save, audited writes) | unset (one user per instance) |
| `DASHBOARD_ALLOWED_HOSTS` | Strict allowlist for the setup "test connection" probe (it is token/session-gated; the metadata sentinel 169.254.169.254 is denied in all modes) | unset (allow for session/token holders) |
| `DATABASE_URL` | SQLite database path | `file:./db/dashboard.db` |
| `NEXT_PUBLIC_BASE_PATH` | URL base path (embedded deployment) | `/dashboard` |

### Stateless deployment mode (`DASHBOARD_STATELESS=1`)

For on-site/LAN deployments where no server-side user state is wanted. The
browser holds its own credential — a Matrix access token (or an optional
Controller admin token for the L1 view) kept in `localStorage` — and presents
it as a bearer token on every request; the server resolves the identity from
that token and the Controller applies its native per-token RBAC. Login goes
through `POST /api/matrix/static-login` (m.login.password proxied to the
operator-approved homeserver).

Security model — read before enabling:

- **XSS = account takeover.** The access token lives in `localStorage`, so any
  script injection into the dashboard origin can exfiltrate it. This is the
  same trust model as the AgentTeams workbench plugin (browser-held
  credentials); only deploy stateless mode on networks and images you control,
  and keep the dashboard image updated.
- **`MATRIX_HOMESERVER_ALLOWLIST` is mandatory.** With it unset, static login
  and device revoke return 403 (`allowlist-not-configured`) — login is
  impossible until the operator pins the approved homeserver hosts. The list is
  exclusive: credentials are only ever forwarded to hosts on it.
- The public `GET /api/agentteams/mode` endpoint reports `authMode` and the
  server-side homeserver candidate list (deploy constants, no secrets).
- Session/audit semantics of the stateful mode (server session cookie, server
  audit of proxied mutations) still apply to the L1 admin-password path;
  stateless L2 traffic is authorized by the Controller itself.

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
| `npm run lint:tone` | AI-tone copy scan (visible copy hard-word gate) |
| `npm run typecheck` | TypeScript type checking |
| `npm test` | Run the vitest test suite |

## 🧪 Quality

- **Unit tests** with vitest + Testing Library (724 tests across 80 files, `npm test`)
- **Lint-clean** ESLint configuration (`npm run lint`)
- **Type-safe** with strict TypeScript (`npm run typecheck`)
- **Reproducible builds** via `npm ci` + lockfile and multi-arch Docker images (`make help`)

## 🗺 Roadmap

- [Worker 卡片生动化改造 + Chat 流式渲染适配（任务书 v0.2）](docs/plans/2026-08-11-worker-card-v2-chat-runtime-ux.md) — Worker 卡片活物条 / 状态叙述 / 运行时特征区，Chat 五种运行时的流式渲染归属与错误收尾统一，文案去 AI 味。

## 🤝 Related Projects

- [AgentTeams](https://github.com/agentscope-ai/AgentTeams) — multi-agent collaboration runtime
- [AgentTeams Controller](https://github.com/higress-group/agentteams) — the Controller

## 📄 License

This project belongs to higress-group. Please refer to the license file in the repository root for details.
