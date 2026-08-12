import { useState, useEffect } from 'react';

/**
 * {{PLUGIN_NAME}} — AgentTeams Dashboard plugin entry.
 *
 * Lifecycle:
 *   activate(api)   called once when the plugin is enabled
 *   deactivate()    called when the plugin is disabled/uninstalled
 *
 * The `api` object is the only surface you need:
 *   api.registerMenuItem / registerRoute / registerWidget /
 *   api.registerDetailBlock / registerToolbarButton
 *   api.events   (cross-plugin event bus)
 *   api.store    (isolated persisted state for this plugin)
 *   api.http     (fetch wrapper with the Dashboard base path)
 *   api.dashboard (cluster data + navigation + toast)
 *   api.log
 */

const deactivateCleanups = [];

export function activate(api) {
  // ── Dashboard widget (shown on the overview page) ──────────────
  function StatusWidget() {
    const [status, setStatus] = useState(null);
    const [error, setError] = useState(null);

    useEffect(() => {
      let cancelled = false;
      api.dashboard
        .getClusterStatus()
        .then((data) => {
          if (!cancelled) setStatus(data);
        })
        .catch((err) => {
          if (!cancelled) setError(err.message || String(err));
        });
      return () => {
        cancelled = true;
      };
    }, []);

    return (
      <div
        style={{
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius, 8px)',
          background: 'var(--card)',
          color: 'var(--card-foreground)',
          padding: 16,
        }}
      >
        <div style={{ fontWeight: 600, marginBottom: 8 }}>
          {{PLUGIN_NAME}}
        </div>
        {error && <div style={{ color: 'var(--destructive)' }}>{error}</div>}
        {!status && !error && <div style={{ opacity: 0.6 }}>加载中…</div>}
        {status && (
          <div style={{ display: 'flex', gap: 16 }}>
            <span>Workers: {status.totalWorkers}</span>
            <span>团队: {status.totalTeams}</span>
            <span>Humans: {status.totalHumans}</span>
          </div>
        )}
      </div>
    );
  }

  // ── Standalone page (opened from the sidebar menu item) ────────
  function HelloPage() {
    const [workers, setWorkers] = useState(null);

    useEffect(() => {
      let cancelled = false;
      api.dashboard
        .listWorkers()
        .then((list) => {
          if (!cancelled) setWorkers(Array.isArray(list) ? list : []);
        })
        .catch(() => {
          if (!cancelled) setWorkers([]);
        });
      return () => {
        cancelled = true;
      };
    }, []);

    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
        <h2 style={{ fontSize: 18, fontWeight: 600 }}>{{PLUGIN_NAME}}</h2>
        <p style={{ opacity: 0.7 }}>
          这是一个由 create-dashboard-plugin 生成的示例插件页面。
        </p>
        <button
          style={{
            alignSelf: 'flex-start',
            padding: '6px 12px',
            borderRadius: 'var(--radius, 8px)',
            border: '1px solid var(--border)',
            background: 'var(--primary)',
            color: 'var(--primary-foreground)',
            cursor: 'pointer',
          }}
          onClick={() => api.dashboard.toast('Hello from {{PLUGIN_ID}}!', 'success')}
        >
          打个招呼
        </button>
        <div>
          {workers === null
            ? '正在获取 Workers…'
            : `当前集群共有 ${workers.length} 个 Worker。`}
        </div>
      </div>
    );
  }

  // ── Registrations ──────────────────────────────────────────────
  const unregisterWidget = api.registerWidget({
    id: 'status-widget',
    title: '{{PLUGIN_NAME}}',
    component: StatusWidget,
    size: 'md',
  });

  const unregisterRoute = api.registerRoute({
    id: 'home',
    title: '{{PLUGIN_NAME}}',
    component: HelloPage,
  });

  const unregisterMenu = api.registerMenuItem({
    id: 'home',
    label: '{{PLUGIN_NAME}}',
    icon: 'sparkles',
    target: { type: 'plugin-route', routeId: 'home' },
  });

  api.log.info('plugin activated');

  // Keep the unregisters so deactivate() can clean up explicitly
  // (the host also force-cleans on disable/uninstall).
  deactivateCleanups.length = 0;
  deactivateCleanups.push(unregisterMenu, unregisterRoute, unregisterWidget);
}

export function deactivate() {
  while (deactivateCleanups.length > 0) {
    const fn = deactivateCleanups.pop();
    try {
      fn();
    } catch {
      /* best effort */
    }
  }
}

export default { activate, deactivate };
