// @vitest-environment node
import { afterEach, expect, it, vi } from 'vitest';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

for (const base of ['', '/dashboard']) {
  it(`keeps project requests and artifact links inside the ${base || 'root'} deployment`, async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', base);
    vi.resetModules();
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(new Response('{}', { status: 200 })));
    vi.stubGlobal('fetch', fetch);
    const api = await import('./agentteams-projects-api');
    await api.listProjects();
    await api.getProjectWorkflow('a/b', { includeTasks: true, teamId: 'team a' });
    await api.pauseProject('a/b');
    expect(fetch.mock.calls.map(([url]) => url)).toEqual([
      `${base}/api/agentteams/projects`,
      `${base}/api/agentteams/projects/a%2Fb/workflow?includeTasks=true&team=team%20a`,
      `${base}/api/agentteams/projects/a%2Fb/pause`,
    ]);
    expect(api.getTaskArtifactUrl('a/b', 'task 1')).toBe(
      `${base}/api/agentteams/projects/a%2Fb/tasks/task%201/artifact`,
    );
  });
}
