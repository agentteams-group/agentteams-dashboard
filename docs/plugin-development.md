# AgentTeams Dashboard Plugin Development Guide

This guide explains how to develop, debug, and publish plugins for the AgentTeams Dashboard. The plugin system lets third-party developers extend the Dashboard **without modifying core code**, keeping their work in sync with upstream.

> 中文版见 [plugin-development.zh-CN.md](./plugin-development.zh-CN.md)。

## Contents

1. [Core Concepts](#core-concepts)
2. [Quick Start](#quick-start)
3. [The plugin.json Manifest](#the-pluginjson-manifest)
4. [Extension Points](#extension-points)
5. [Plugin API Reference](#plugin-api-reference)
6. [State Isolation & Event Bus](#state-isolation--event-bus)
7. [Dynamic Loading & Error Boundaries](#dynamic-loading--error-boundaries)
8. [Development & Hot Reload](#development--hot-reload)
9. [Publishing](#publishing)
10. [Compatibility with the AgentTeams Ecosystem](#compatibility-with-the-agentteams-ecosystem)
11. [Best Practices](#best-practices)

---

## Core Concepts

- **Plugin**: a standalone project with a `plugin.json` manifest and an ES-module entry. The entry exports `activate(api)` (and optionally `deactivate()`).
- **Extension Point**: a fixed place in the Dashboard where plugins may inject UI. Five are provided: sidebar menu, standalone route, dashboard widget, detail-panel block, toolbar button.
- **Plugin API**: the `api` object passed to `activate`. It is the only surface a plugin uses to talk to the Dashboard: registration methods, event bus, isolated store, HTTP wrapper, and cluster-data services.
- **Registry**: the Dashboard's record of installed/enabled/disabled/uninstalled plugins and their metadata.
- **Loader**: loads plugin modules at runtime via dynamic `import()` (no Module Federation, no extra build configuration).

### Lifecycle

```
install → activate → (render) → deactivate → uninstall
```

---

## Quick Start

Scaffold a plugin project:

```bash
# from the agentteams-dashboard repository root
node tools/create-dashboard-plugin/bin/cli.js my-plugin

# or, once published
npm create dashboard-plugin my-plugin
```

Generated layout:

```
my-plugin/
├─ package.json
├─ vite.config.mjs             # dev/build config
├─ vite-plugin-host-react.mjs  # maps react to the host instance
├─ public/plugin.json          # manifest
└─ src/main.jsx                # entry: activate/deactivate
```

Start the dev server and connect it to the Dashboard:

```bash
cd my-plugin
npm install
npm run dev        # http://localhost:5173
```

In the Dashboard, open *Settings → Plugins → Install from URL* and enter `http://localhost:5173/plugin.json`. A sidebar entry and an overview widget will appear.

> You can also inject dev plugins via env var (comma-separated):
> `NEXT_PUBLIC_PLUGIN_DEV_URLS=http://localhost:5173/plugin.json`

---

## The plugin.json Manifest

```json
{
  "apiVersion": "dashboard.agentteams/v1",
  "kind": "DashboardPlugin",
  "id": "my-plugin",
  "name": "My Plugin",
  "version": "1.0.0",
  "description": "What it does",
  "author": "Your Name",
  "entry": { "dashboard": "src/main.jsx" },
  "dashboardVersion": ">=0.2.0",
  "extensionPoints": ["sidebar-menu", "route", "dashboard-widget"],
  "permissions": ["network"]
}
```

| Field | Required | Description |
| --- | --- | --- |
| `id` | yes | Unique id: lowercase letters, digits, `-`, `_` |
| `name` | yes | Display name |
| `version` | yes | Semver (e.g. `1.0.0`) |
| `entry.dashboard` | yes | Dashboard ES-module entry (path relative to the manifest, or a URL) |
| `entry.backend` | no | Upstream AgentTeams backend entry (ignored by the Dashboard) |
| `dashboardVersion` | no | Compatible Dashboard version range (semver), e.g. `>=0.2.0`, `^0.2.0`, `0.x` |
| `min_version` | no | Upstream-style field, equivalent to `>=min_version` |
| `extensionPoints` | no | Declares which extension points are used; enforced when present |
| `permissions` | no | Declarative permission list (informational) |
| `dependencies` | no | Other plugin ids this plugin depends on |

**Version gating**: on install, the Dashboard matches its own version against `dashboardVersion`/`min_version` and rejects incompatible plugins with a clear message.

---

## Extension Points

| Point | Registration | Where it appears |
| --- | --- | --- |
| `sidebar-menu` | `api.registerMenuItem` | Sidebar "Plugins" group |
| `route` | `api.registerRoute` | Standalone page in the main area |
| `dashboard-widget` | `api.registerWidget` | Overview page widget grid |
| `detail-panel` | `api.registerDetailBlock` | Entity detail dialogs (e.g. Worker detail) |
| `toolbar` | `api.registerToolbarButton` | Top toolbar |

### Sidebar menu

```js
api.registerMenuItem({
  id: 'home',
  label: 'My Page',
  icon: 'sparkles',
  target: { type: 'plugin-route', routeId: 'home' },
  order: 10,
});
```

`target` supports: `{ type: 'plugin-route', routeId }`, `{ type: 'section', sectionId }`, `{ type: 'href', url }`.

### Route

```jsx
api.registerRoute({ id: 'home', title: 'My Page', component: MyPage });
```

### Dashboard widget

```jsx
api.registerWidget({ id: 'status', title: 'Status', component: StatusCard, size: 'md', order: 1 });
```

### Detail-panel block

```jsx
api.registerDetailBlock({ id: 'extra', entity: 'worker', component: WorkerExtra });
```

The component receives `{ entity }` (the current entity object).

### Toolbar button

```jsx
api.registerToolbarButton({ id: 'ping', label: 'Ping', icon: 'zap', onClick: () => api.dashboard.toast('Hello!', 'success') });
```

### Icon whitelist

`icon` is a name string (icons cross a serialization boundary). Available names include: `activity`, `alert`, `archive`, `bar-chart`, `bell`, `book`, `bot`, `box`, `brain`, `check`, `clipboard`, `clock`, `cloud`, `cpu`, `database`, `eye`, `file`, `flag`, `gauge`, `git-branch`, `globe`, `heart`, `home`, `info`, `layers`, `layout-dashboard`, `link`, `list`, `lock`, `mail`, `map`, `message-square`, `network`, `package`, `pie-chart`, `plug`, `puzzle`, `rocket`, `rss`, `search`, `server`, `settings`, `shield`, `sparkles`, `star`, `target`, `terminal`, `trending-up`, `upload`, `user`, `users`, `wifi`, `wrench`, `zap`. Unknown names fall back to a puzzle icon.

---

## Plugin API Reference

### Identity

`api.pluginId`, `api.dashboardVersion`, `api.pluginApiVersion`.

### Registration (each returns an `unregister` function)

- `api.registerMenuItem(item)`
- `api.registerRoute(route)`
- `api.registerWidget(widget)`
- `api.registerDetailBlock(block)`
- `api.registerToolbarButton(button)`
- `api.registerComponent(point, contribution)` — generic dispatch by point id.

### Event bus `api.events` (mitt-backed, shared across plugins and host)

- `api.events.on(event, handler) → unregister`
- `api.events.off(event, handler)`
- `api.events.emit(event, payload)`

Host lifecycle events: `host:plugin-activated`, `host:plugin-deactivated`, `host:plugin-error`, `host:section-changed`.

### Isolated store `api.store`

- `getState()`, `setState(partial)`, `subscribe(listener)`.
- Namespaced persistence (`agentteams-plugin-state:<id>`); plugins cannot reach host or peer stores.

### HTTP `api.http`

- `fetch(path, init)`, `get<T>(path)`, `post<T>(path, body?)` — basePath-aware, same-origin credentials.

### Dashboard services `api.dashboard`

- `navigate(sectionId)`
- `toast(message, type?)`
- `getClusterStatus()`, `getVersion()`, `listWorkers()`, `listTeams()`, `listManagers()`, `listHumans()`

### Logger `api.log`

`info`/`warn`/`error`, prefixed `[plugin:<id>]`.

---

## State Isolation & Event Bus

- **State isolation**: `api.store` is a standalone Zustand store per plugin; no shared global state can be polluted.
- **Single React instance**: the host exposes React/ReactDOM on `window.__AGENTTEAMS_DASHBOARD_HOST__`; the scaffold aliases `react`/`react-dom`/`react/jsx-runtime` to that instance so hooks/context work. **Never bundle your own React.**
- **Communication**: use `api.events` for cross-plugin/host messaging.

---

## Dynamic Loading & Error Boundaries

- **Lazy loading**: plugin entries load via runtime dynamic `import()`, off the first-paint critical path (LCP target ≤ 2.5s).
- **Error boundaries**: every contribution renders inside its own boundary. A failing plugin shows its own error card and is marked `error` in the registry — **the main Dashboard is unaffected**.
- **Failure cleanup**: if `activate` throws, the host removes any contributions the plugin already registered.

---

## Development & Hot Reload

1. `npm run dev` starts the plugin dev server (CORS enabled).
2. Install the manifest URL in the Dashboard.
3. Edit `src/main.jsx` and save — the Dashboard in **development mode** polls the entry and hot-reloads the plugin automatically (no page refresh).

> Production build: `npm run build` outputs `dist/main.js`. Deploy it with a manifest whose `entry.dashboard` points to `dist/main.js`.

---

## Publishing

1. Develop and test against a local Dashboard.
2. `npm run build`.
3. Host `plugin.json` + `dist/` on any static server; ensure `entry.dashboard` resolves.
4. Users install via the manifest URL, or operators preconfigure `NEXT_PUBLIC_PLUGIN_DEV_URLS`.
5. To upgrade, bump `version`, redeploy, and reload the plugin.

---

## Compatibility with the AgentTeams Ecosystem

The manifest aligns with upstream [AgentTeams](https://github.com/agentscope-ai/AgentTeams) plugin fields (`id`/`name`/`version`/`description`/`author`/`entry`/`dependencies`/`min_version`). A single plugin package can carry both `entry.backend` (AgentTeams Python entry) and `entry.dashboard` (Dashboard JS entry); the Dashboard consumes only the latter, reusing the same ecosystem and distribution channels.

---

## Best Practices

1. Access data only through `api`; never import Dashboard internals.
2. Keep components light; avoid heavy computation or high-frequency polling in overview widgets.
3. Clean up side effects in `deactivate` (timers, subscriptions).
4. Declare `extensionPoints` for reviewability.
5. Namespace your events (`my-plugin:*`).
6. Do not bundle React; reuse the host instance.
7. Set a sensible `dashboardVersion` range.
8. Handle data-loading failures gracefully inside components.
