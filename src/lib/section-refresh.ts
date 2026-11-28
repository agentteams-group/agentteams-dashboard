import type { QueryClient, QueryKey } from '@tanstack/react-query';

export const REFRESH_BATCH_SIZE = 6;

interface RefreshRule {
  prefix: readonly unknown[];
  /** Parameter index containing the Matrix room id, when room-scoped. */
  roomIndex?: number;
}

const PROJECT_RULES: RefreshRule[] = [
  { prefix: ['agentteams-projects'] },
  { prefix: ['agentteams-task-index'] },
  { prefix: ['agentteams-project-workflow'] },
  { prefix: ['agentteams-project-workflow-batch'] },
  { prefix: ['team-tasks'] },
  { prefix: ['task-detail'] },
];

const SHELL_RESOURCE_RULES: RefreshRule[] = [
  { prefix: ['agentteams-workers'] },
  { prefix: ['agentteams-worker-detail'] },
  { prefix: ['agentteams-worker-skills'] },
  { prefix: ['agentteams-teams'] },
  { prefix: ['agentteams-team-attention'] },
  { prefix: ['agentteams-managers'] },
  { prefix: ['agentteams-humans'] },
  { prefix: ['agentteams-cluster-status'] },
  { prefix: ['agentteams-infrastructure'] },
];

const SECTION_RULES: Record<string, RefreshRule[]> = {
  overview: [
    ...PROJECT_RULES,
    ...SHELL_RESOURCE_RULES,
    { prefix: ['agentteams-coding-runs'] },
    { prefix: ['loops-run-instances'] },
    { prefix: ['dashboard-runtime'] },
  ],
  tasks: PROJECT_RULES,
  artifacts: PROJECT_RULES,
  'coding-runs': [{ prefix: ['agentteams-coding-runs'] }],
  loops: [{ prefix: ['loops-run-instances'] }],
  resources: SHELL_RESOURCE_RULES,
  'team-agents': SHELL_RESOURCE_RULES,
  workers: SHELL_RESOURCE_RULES,
  teams: SHELL_RESOURCE_RULES,
  skills: [
    { prefix: ['agentteams-skills'] },
    { prefix: ['agentteams-skill'] },
  ],
  humans: [
    { prefix: ['agentteams-humans'] },
    { prefix: ['agentteams-human-detail'] },
    { prefix: ['agentteams-human-config'] },
    { prefix: ['agentteams-human-quota'] },
    { prefix: ['agentteams-human-sync'] },
    { prefix: ['human-files'] },
    { prefix: ['human-files-recursive'] },
    { prefix: ['human-files-search'] },
    { prefix: ['human-trash'] },
    { prefix: ['human-quota'] },
  ],
  models: [
    { prefix: ['agentteams-models'] },
    { prefix: ['agentteams-ai-routes'] },
    { prefix: ['agentteams-model-bindings'] },
    { prefix: ['agentteams-sglang-models'] },
  ],
  tools: [
    { prefix: ['agentteams-mcps'] },
    { prefix: ['agentteams-mcp'] },
  ],
  files: [
    { prefix: ['human-files'] },
    { prefix: ['human-files-recursive'] },
    { prefix: ['human-files-search'] },
    { prefix: ['human-trash'] },
    { prefix: ['human-quota'] },
  ],
  audit: [{ prefix: ['audit-events'] }],
  tracing: [
    { prefix: ['trace-resources'] },
    { prefix: ['traces'] },
    { prefix: ['trace'] },
    { prefix: ['observability-config'] },
  ],
  chat: [
    ...PROJECT_RULES,
    { prefix: ['agentteams-workers'] },
    { prefix: ['agentteams-teams'] },
    { prefix: ['agentteams-managers'] },
    { prefix: ['agentteams-humans'] },
    { prefix: ['chat-room-access'] },
    { prefix: ['archived-rooms'] },
    { prefix: ['task-room-archive'], roomIndex: 4 },
    { prefix: ['matrix-messages'], roomIndex: 1 },
    { prefix: ['matrix-members'], roomIndex: 1 },
    { prefix: ['matrix-state'], roomIndex: 1 },
    { prefix: ['matrix-thread'], roomIndex: 1 },
    { prefix: ['matrix-read-marker'], roomIndex: 1 },
    { prefix: ['matrix-event'], roomIndex: 3 },
    { prefix: ['matrix-reply-target'], roomIndex: 3 },
    { prefix: ['message-read-status'], roomIndex: 3 },
    { prefix: ['chat-workflow-live'] },
    { prefix: ['chat-attachment-preview'] },
    { prefix: ['chat-personal-human'] },
    { prefix: ['manager-model-status'] },
    { prefix: ['room-files'], roomIndex: 1 },
    { prefix: ['room-release-state'], roomIndex: 1 },
    { prefix: ['artifact-comments'], roomIndex: 1 },
  ],
};

SECTION_RULES['my-teams'] = SECTION_RULES.chat;

function startsWithKey(key: QueryKey, prefix: readonly unknown[]): boolean {
  return prefix.every((part, index) => Object.is(key[index], part));
}

export function sectionRefreshRules(section: string): RefreshRule[] {
  return SECTION_RULES[section] ?? [];
}

export function queryMatchesSection(
  queryKey: QueryKey,
  section: string,
  activeRoomId?: string | null,
): boolean {
  return sectionRefreshRules(section).some(rule => {
    if (!startsWithKey(queryKey, rule.prefix)) return false;
    if (rule.roomIndex === undefined) return true;
    return Boolean(activeRoomId) && queryKey[rule.roomIndex] === activeRoomId;
  });
}

function yieldToBrowser(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

/**
 * Invalidate only the current section, then refetch active queries in batches
 * of six. The initial yield lets the click paint its busy state before cache
 * work starts; duplicate keys are naturally collapsed by queryHash.
 */
export async function refreshSectionQueries(
  queryClient: QueryClient,
  section: string,
  activeRoomId?: string | null,
): Promise<void> {
  await yieldToBrowser();
  const predicate = (query: { queryKey: QueryKey }) => queryMatchesSection(query.queryKey, section, activeRoomId);
  await queryClient.invalidateQueries({ predicate, refetchType: 'none' });
  const queries = queryClient.getQueryCache().findAll({ predicate })
    .filter(query => query.getObserversCount() > 0)
    .filter((query, index, all) => all.findIndex(candidate => candidate.queryHash === query.queryHash) === index);

  for (let index = 0; index < queries.length; index += REFRESH_BATCH_SIZE) {
    const batch = queries.slice(index, index + REFRESH_BATCH_SIZE);
    await Promise.all(batch.map(query => query.fetch()));
    if (index + REFRESH_BATCH_SIZE < queries.length) await yieldToBrowser();
  }
}
