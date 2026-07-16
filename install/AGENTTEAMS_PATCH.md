# AgentTeams Integration Patches

This document describes how to integrate AgentTeams-Dashboard into the AgentTeams installation scripts.

## Option A: Standalone Install (Recommended for existing installations)

Run directly against an existing AgentTeams deployment:

```bash
bash install/agentteams-dashboard.sh          # install (first time)
bash install/agentteams-dashboard.sh update   # pull latest & recreate
bash install/agentteams-dashboard.sh uninstall
```

## Option B: Patch into AgentTeams Install Script

Apply the patches in `install/patches/` to the AgentTeams repository.

### Quick Apply (using the patch files)

```bash
cd /path/to/AgentTeams
git apply /path/to/AgentTeams-Dashboard/install/patches/0001-agentteams-install-dashboard.patch
git apply /path/to/AgentTeams-Dashboard/install/patches/0002-agentteams-verify-dashboard.patch
git apply /path/to/AgentTeams-Dashboard/install/patches/0003-Makefile-dashboard.patch
```

### Regenerate Patches

The patch files are generated from a working AgentTeams branch. To update them:

```bash
# 1. Edit the AgentTeams files directly (install/agentteams-install.sh,
#    install/agentteams-verify.sh, Makefile) to add or modify Dashboard integration.
# 2. Commit each file separately with a descriptive message.
# 3. Generate patches:
git format-patch HEAD~3 -o /path/to/AgentTeams-Dashboard/install/patches/
# 4. Rename the generated files to the canonical names if necessary:
#    0001-agentteams-install-dashboard.patch
#    0002-agentteams-verify-dashboard.patch
#    0003-Makefile-dashboard.patch
```

### Manual Integration Summary

The patches make the following changes:

#### 1. `install/agentteams-install.sh`

- Add documented environment variables near the top (with other `AGENTTEAMS_` vars):
  - `AGENTTEAMS_DASHBOARD` — install Dashboard (default: 1)
  - `AGENTTEAMS_PORT_DASHBOARD` — Dashboard host port (default: 13000)
  - `AGENTTEAMS_DASHBOARD_IMAGE` — override Dashboard image
  - `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` — Higress Console URL for shared auth
- Add Dashboard i18n messages (`success.dashboard.*`, `dash.*`).
- Add `DASHBOARD_IMAGE` and `AGENTTEAMS_AI_GATEWAY_ADMIN_URL` defaults in `resolve_image_tags()`.
- Load Dashboard variables from the saved env file in `load_current_params_from_env()`.
- Add `step_dashboard()` wizard function after `step_workspace()`.
- Add `step_dashboard` to the `_STEPS` state-machine array.
- Add `step_dashboard` handling to `should_skip_step()` and `clear_step_vars()`.
- Start the `agentteams-dashboard` container after the embedded controller is ready.
- Print the Dashboard URL in the success banner when Dashboard is enabled.
- Persist Dashboard variables in the generated `.env` file.

#### 2. `install/agentteams-verify.sh`

- Read `AGENTTEAMS_PORT_DASHBOARD` from the Manager container env.
- Add a 7th check that verifies Dashboard is accessible on its configured port.

#### 3. `Makefile`

- Add `DASHBOARD_CONTEXT ?= ./AgentTeams-Dashboard/`.
- Add `install-dashboard`, `update-dashboard`, and `uninstall-dashboard` to `.PHONY`.
- Add a `build-dashboard` target.
- Add `install-dashboard`, `update-dashboard`, and `uninstall-dashboard` targets.

## Quick Reference

| Action | Command |
|--------|---------|
| Standalone install | `bash install/agentteams-dashboard.sh` |
| Update (pull latest) | `bash install/agentteams-dashboard.sh update` |
| Uninstall | `bash install/agentteams-dashboard.sh uninstall` |
| Build image only | `make build-dashboard` |
| View logs | `docker logs -f agentteams-dashboard` |
| Default port | `13000` |
| LAN access | Controlled by `AGENTTEAMS_LOCAL_ONLY` (binds `0.0.0.0` when disabled) |
| Auth mode | Higress shared auth (if URL configured) or local fallback |
