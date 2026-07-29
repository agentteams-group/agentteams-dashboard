import packageJson from '../../package.json';

const startedAt = Date.now();

export const DASHBOARD_REPOSITORY = 'https://github.com/agentteams-group/agentteams-dashboard';

export function getDashboardRuntimeInfo() {
  return {
    repository: DASHBOARD_REPOSITORY,
    version: packageJson.version,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    startedAt: new Date(startedAt).toISOString(),
  };
}
