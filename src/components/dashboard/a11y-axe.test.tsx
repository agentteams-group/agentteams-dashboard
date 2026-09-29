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
import { SearchProvider } from '@/lib/search-context';

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
});
