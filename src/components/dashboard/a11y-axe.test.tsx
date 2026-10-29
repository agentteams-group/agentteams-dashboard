// @vitest-environment jsdom
// Task 9.5 (A11Y): axe-core sweep over the workers / chat / settings key
// sections. We assert on critical / serious violations only — moderate
// issues (e.g. color-frugal contrast heuristics inside mocked-away data)
// stay out of scope here; the token-level contrast math has its own test.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import axe from 'axe-core';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { TooltipProvider } from '@/components/ui/tooltip';

const hooksMock = vi.hoisted(() => ({
  useWorkers: vi.fn(),
  useTeams: vi.fn(),
  useManagers: vi.fn(),
  useHumans: vi.fn(),
}));

vi.mock('@/hooks/use-agentteams-workers', () => ({ useWorkers: hooksMock.useWorkers }));
vi.mock('@/hooks/use-agentteams-teams', () => ({ useTeams: hooksMock.useTeams }));
vi.mock('@/hooks/use-agentteams-managers', () => ({ useManagers: hooksMock.useManagers }));
vi.mock('@/hooks/use-agentteams-humans', () => ({ useHumans: hooksMock.useHumans }));

vi.mock('@/lib/agentteams-store', () => ({
  useAgentTeamsStore: () => ({ isConnected: true }),
}));

vi.mock('@/lib/matrix-store', () => ({
  useMatrixStore: () => ({ isLoggedIn: true, userId: '@user:test' }),
}));

vi.mock('@/hooks/use-model-selection', () => ({
  useModelSelection: () => ({
    providers: [],
    aiRoutes: [],
    sglangModels: [],
    bindings: {},
    isLoading: false,
  }),
}));

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), success: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));

import { WorkersSection } from '@/components/dashboard/sections/workers-section';
import { ChatSection } from '@/components/dashboard/sections/chat/ChatSection';
import { ThemeTab } from '@/components/dashboard/settings/theme-tab';
import { TasksSection } from '@/components/dashboard/sections/tasks-section';
import { MyWorkbenchSection } from '@/components/dashboard/sections/my-workbench-section';
import { ReplayTimeline } from '@/app/replay/[id]/replay-timeline';
import { TopologyOverview } from '@/components/dashboard/sections/teams/team-topology-overview';
import { SearchProvider } from '@/lib/search-context';
import { contrastRatio } from '@/lib/theme/contrast.test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <SearchProvider>
        <TooltipProvider>{children}</TooltipProvider>
      </SearchProvider>
    </QueryClientProvider>
  );
}

const WORKER = {
  name: 'w-1',
  displayName: 'w-1',
  phase: 'Running',
  state: 'running',
  containerManaged: false,
  model: 'default',
  runtime: 'qwenpaw',
  image: 'img',
  containerState: 'running',
  matrixUserID: '@w-1:test',
  roomID: '!room:test',
  message: '',
  team: 'alpha',
  role: 'worker',
} as Record<string, unknown>;

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

async function expectNoCritical(container: HTMLElement): Promise<void> {
  const results = await axe.run(container, { resultTypes: ['violations'] });
  const blocking = results.violations.filter(
    (v) => v.impact === 'critical' || v.impact === 'serious',
  );
  if (blocking.length > 0) {
    throw new Error(
      blocking
        .map(
          (v) =>
            `[${v.impact}] ${v.id}: ${v.help} (${v.nodes.length} node(s))\n` +
            v.nodes.map((n) => `  ${n.html.slice(0, 200)}`).join('\n'),
        )
        .join('\n'),
    );
  }
  expect(blocking).toHaveLength(0);
}

describe('axe-core critical sweep (task 9.5)', () => {
  it('workers section has no critical/serious violations', async () => {
    hooksMock.useWorkers.mockReturnValue({
      data: [WORKER],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    hooksMock.useTeams.mockReturnValue({ data: [], isLoading: false });
    hooksMock.useManagers.mockReturnValue({ data: [], isLoading: false });
    hooksMock.useHumans.mockReturnValue({ data: [], isLoading: false });
    const { container } = render(<WorkersSection />, { wrapper: makeWrapper() });
    await expectNoCritical(container);
  });

  it('chat section has no critical/serious violations', async () => {
    hooksMock.useWorkers.mockReturnValue({
      data: [WORKER],
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    hooksMock.useTeams.mockReturnValue({ data: [], isLoading: false });
    hooksMock.useManagers.mockReturnValue({ data: [], isLoading: false });
    hooksMock.useHumans.mockReturnValue({ data: [], isLoading: false });
    const { container } = render(<ChatSection />, { wrapper: makeWrapper() });
    await expectNoCritical(container);
  });

  it('settings theme tab has no critical/serious violations', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    const { ThemeProvider } = await import('@/components/theme/theme-provider');
    const { container } = render(
      <ThemeProvider>
        <ThemeTab />
      </ThemeProvider>,
      { wrapper: makeWrapper() },
    );
    await expectNoCritical(container);
  });

  it('tasks section has no critical/serious violations (A-6)', async () => {
    const { container } = render(<TasksSection />, { wrapper: makeWrapper() });
    await expectNoCritical(container);
  });

  it('my-workbench section has no critical/serious violations (A-6)', async () => {
    const { container } = render(<MyWorkbenchSection />, { wrapper: makeWrapper() });
    await expectNoCritical(container);
  });

  it('replay timeline has no critical/serious violations (A-6)', async () => {
    const sampleEvent = {
      event_id: '$e1',
      type: 'm.room.message',
      sender: '@architect:local',
      origin_server_ts: 1730000000000,
      content: { msgtype: 'm.text', body: '回放时间线可访问性核验' },
    };
    const { container } = render(<ReplayTimeline events={[sampleEvent]} />, {
      wrapper: makeWrapper(),
    });
    await expectNoCritical(container);
  });

  it('topology overview has no critical/serious violations (A-6)', async () => {
    const { container } = render(<TopologyOverview />, { wrapper: makeWrapper() });
    await expectNoCritical(container);
  });
});

describe('A-6 语义状态色对比度显式断言 (三套主题 ≥4.5:1)', () => {
  const css = readFileSync(resolve(__dirname, '../../app/globals.css'), 'utf8');

  function getSectionVars(selector: string): Record<string, string> {
    const re = new RegExp(`${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{([\\s\\S]*?)\\}`);
    const m = css.match(re);
    if (!m) throw new Error(`section ${selector} not found`);
    const vars: Record<string, string> = {};
    for (const vm of m[1].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) {
      vars[vm[1]] = vm[2].trim();
    }
    return vars;
  }

  const STATUS_TOKENS = [
    '--status-running',
    '--status-waiting',
    '--status-blocked',
    '--status-done',
    '--status-failed',
    '--status-info',
  ];

  it.each([
    ['light', ':root', 4.5],
    ['dark', '.dark', 4.5],
    ['high-contrast', '.high-contrast', 7.0],
  ] as const)('%s 主题下 6 个状态 token 与 --card 对比度达标', (_, selector, minRatio) => {
    const vars = getSectionVars(selector);
    for (const token of STATUS_TOKENS) {
      const value = vars[token];
      expect(value, `${selector} 缺少状态色 ${token}`).toBeDefined();
      const ratio = contrastRatio(value, vars['--card']);
      expect(ratio, `${token} on --card in ${selector} ratio ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(minRatio);
    }
  });
});
