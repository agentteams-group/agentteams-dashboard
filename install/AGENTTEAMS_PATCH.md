# AgentTeams Integration Patches

This document describes how to integrate agentteams-dashboard into the AgentTeams installation scripts.

## Option A: Standalone Install (Recommended for existing installations)

Run directly against an existing AgentTeams deployment:

```bash
bash install/agentteams-dashboard.sh          # install (first time)
bash install/agentteams-dashboard.sh update   # pull latest & recreate
bash install/agentteams-dashboard.sh uninstall
```

**Windows (PowerShell)**:

```powershell
.\install\agentteams-dashboard.ps1
```

## Option B: Patch into AgentTeams Install Script

Apply the patch in `install/patches/` to the AgentTeams repository.

### Quick Apply (using the patch file)

```bash
cd /path/to/AgentTeams
git apply /path/to/agentteams-dashboard/install/patches/0001-agentteams-install-dashboard.patch
git apply /path/to/agentteams-dashboard/install/patches/0002-agentteams-verify-dashboard.patch
git apply /path/to/agentteams-dashboard/install/patches/0003-Makefile-dashboard.patch
```

> **Note**: The integration is split into three patch files:
> - `0001-agentteams-install-dashboard.patch` — `install/agentteams-install.sh` + new `install/agentteams-dashboard-tests.sh`
> - `0002-agentteams-verify-dashboard.patch` — `install/agentteams-verify.sh`
> - `0003-Makefile-dashboard.patch` — `Makefile`

### Regenerate Patches

The patch files are generated from a working AgentTeams checkout based on
`upstream/main`. To update:

```bash
# 1. Edit the AgentTeams files directly (install/agentteams-install.sh,
#    install/agentteams-dashboard-tests.sh, install/agentteams-verify.sh,
#    Makefile) to add or modify Dashboard integration.
# 2. Generate patches:
git add -A
git diff --cached -- install/agentteams-dashboard-tests.sh install/agentteams-install.sh \
  > /path/to/agentteams-dashboard/install/patches/0001-agentteams-install-dashboard.patch
git diff --cached -- install/agentteams-verify.sh \
  > /path/to/agentteams-dashboard/install/patches/0002-agentteams-verify-dashboard.patch
git diff --cached -- Makefile \
  > /path/to/agentteams-dashboard/install/patches/0003-Makefile-dashboard.patch
# 3. Verify (clean apply to upstream/main):
git stash && for p in /path/to/agentteams-dashboard/install/patches/*.patch; do git apply --check "$p"; done && git stash pop
```

### Integration Features

The patch adds the following capabilities:

#### 1. `install/agentteams-install.sh`

**Environment Variables** (documented near the top, alongside other `AGENTTEAMS_` vars):

| Variable | Default | Description |
|----------|---------|-------------|
| `AGENTTEAMS_DASHBOARD` | `1` | Install Dashboard? (1=yes, 0=no) |
| `AGENTTEAMS_DASHBOARD_VERSION` | `v1.2.0-beta.1` | Dashboard version tag (independent of AgentTeams version) |
| `AGENTTEAMS_PORT_DASHBOARD` | `13000` | Dashboard host port |
| `AGENTTEAMS_DASHBOARD_IMAGE` | derived | Full image reference (uses `AGENTTEAMS_DASHBOARD_VERSION`) |
| `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` | auto-detected | Higress Console URL for shared login |

**Key Features**:

- **Independent versioning**: `AGENTTEAMS_DASHBOARD_VERSION` is separate from `AGENTTEAMS_VERSION`, so AgentTeams and Dashboard can release on different schedules.
- **Full env persistence**: All 5 Dashboard config variables are loaded from saved env in `load_current_params_from_env()`, persisted to the generated env file, and cleared on `reset_dashboard`. Keep-all upgrades preserve all Dashboard settings.
- **Explicit URL priority**: `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` takes priority over auto-detection. Auto-detect (`http://agentteams-controller:8001`) is only used as a fallback when no explicit URL is configured.
- **URL normalization**: If the user enters a URL without a protocol (e.g. `aigw-local.agentteams.io:8001`), `http://` is automatically prepended.
- **CLI token polling**: The Dashboard waits up to 30 seconds for the controller's CLI SA token to be generated (it's created asynchronously in the first reconcile loop). Falls back gracefully if unavailable.
- **Legacy HiClaw compatibility**: Also checks `/var/run/hiclaw/cli-token` for older HiClaw-era images.
- **URL reachability check**: Verifies the Higress Console URL is reachable before starting; warns if not (best-effort, doesn't block install).
- **Bilingual (zh/en)**: All wizard prompts and messages support both Chinese and English.
- **Platform note**: Linux/macOS only (Bash installer). PowerShell installer does not include Dashboard support.

**Functions added**:

- `step_dashboard()` — interactive wizard step for Dashboard configuration
- `_start_dashboard()` — starts the Dashboard container with auto-detected env vars
- `_wait_dashboard_ready()` — polls until Dashboard responds with HTTP 200/301/302

#### 2. `install/agentteams-verify.sh`

- Reads `AGENTTEAMS_PORT_DASHBOARD` from the controller/env
- Adds a Dashboard accessibility check (verifies HTTP response on configured port)
- Works in both embedded mode and standalone mode

#### 3. `Makefile`

**Variables**:

| Variable | Default | Description |
|----------|---------|-------------|
| `DASHBOARD_CONTEXT` | `../agentteams-dashboard` | Path to dashboard source tree |
| `DASHBOARD_VERSION` | `v1.2.0-beta.1` | Dashboard version tag |
| `DASHBOARD_IMAGE` | derived | Full image reference |
| `AGENTTEAMS_PORT_DASHBOARD` | `13000` | Dashboard host port |

**Targets**:

| Target | Description | Prerequisites |
|--------|-------------|---------------|
| `build-dashboard` | Build Dashboard image from local source | `DASHBOARD_CONTEXT` must exist |
| `install-dashboard` | Install/start Dashboard container | `agentteams-controller` must be running |
| `update-dashboard` | Rebuild image + restart Dashboard | `build-dashboard` as dependency |
| `uninstall-dashboard` | Stop and remove Dashboard container | None |
| `wait-dashboard-ready` | Wait for Dashboard to respond | Dashboard must be starting |

**Prerequisites clearly documented**:
- AgentTeams must already be installed (controller running)
- For build: `DASHBOARD_CONTEXT` must point to a dashboard repo
- Linux/macOS only (Bash installer)

### Legacy Cleanup

The patch does **not** add broad `agentteams-*` container cleanup. It only removes the known legacy `agentteams-docker-proxy` container (exact name match). The Dashboard container is also matched exactly (`^agentteams-dashboard$`).

## Quick Reference

| Action | Command |
|--------|---------|
| Standalone install | `bash install/agentteams-dashboard.sh` |
| Update (pull latest) | `bash install/agentteams-dashboard.sh update` |
| Uninstall | `bash install/agentteams-dashboard.sh uninstall` |
| Build image only | `make build-dashboard` |
| Install via Makefile | `make install-dashboard` |
| View logs | `docker logs -f agentteams-dashboard` |
| Default port | `13000` |
| LAN access | Controlled by `AGENTTEAMS_LOCAL_ONLY` (binds `0.0.0.0` when disabled) |
| Auth mode | Higress shared auth (if URL configured) or local fallback |
| CLI token | Polled for 30s from `/var/run/agentteams/cli-token` (legacy: `/var/run/hiclaw/cli-token`) |

## Roadmap / TODO

### Short-term (next release)

- [ ] **PowerShell installer parity** — add Dashboard integration to `agentteams-install.ps1`
- [ ] **Health check endpoint** — dedicated `/api/health` endpoint for readiness probing
- [ ] **Upgrade guide** — document upgrade path from standalone to integrated install

### Medium-term

- [ ] **Dashboard settings page** — configure Dashboard preferences from the UI
- [ ] **Real-time updates** — WebSocket/SSE for live Worker/Team status updates
- [ ] **Multi-cluster support** — manage multiple AgentTeams clusters from one Dashboard
- [ ] **Dark mode** — UI theme toggle

### Long-term / Ideas

- [ ] **Plugin system** — extensible Dashboard with custom modules
- [ ] **Metrics & monitoring** — Prometheus/Grafana integration for performance metrics
- [ ] **Audit log viewer** — browse and search audit trails
- [ ] **CLI integration** — `agt dashboard` subcommand for quick access

## Related Links

- AgentTeams repository: https://github.com/agentscope-ai/AgentTeams
- Dashboard repository: https://github.com/agentteams-group/agentteams-dashboard
- Integration PR: https://github.com/agentscope-ai/AgentTeams/pull/1075
- Tagged releases: https://github.com/agentteams-group/agentteams-dashboard/tags
