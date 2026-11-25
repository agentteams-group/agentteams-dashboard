import { render, screen, waitFor, cleanup, fireEvent, within } from '@testing-library/react';
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

vi.mock('@/hooks/use-audit-events', () => ({
  useAuditEvents: vi.fn(),
}));

import { useAuditEvents, type AuditEventsResponse } from '@/hooks/use-audit-events';
import { AuditSection } from './audit-section';
import { TooltipProvider } from '@/components/ui/tooltip';

const mockedUseAuditEvents = vi.mocked(useAuditEvents);

function makeWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchInterval: false } },
  });
  return ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}><TooltipProvider>{children}</TooltipProvider></QueryClientProvider>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  cleanup();
});

describe('AuditSection', () => {
  it('renders an inline notice when the API returns 403 for an L1 caller', async () => {
    mockedUseAuditEvents.mockReturnValue({
      data: { success: false, error: '需要审计权限', observedLevel: 1, requiredLevel: 2 },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAuditEvents>);
    render(<AuditSection />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText('需要审计权限')).toBeInTheDocument();
    });
    expect(screen.getByText(/L1/)).toBeInTheDocument();
    expect(screen.getByText(/≥ L2/)).toBeInTheDocument();
  });

  it('points to dev-mode hint when the server received no identity header', async () => {
    mockedUseAuditEvents.mockReturnValue({
      data: { success: false, error: '需要审计权限', observedLevel: null, requiredLevel: 2 },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAuditEvents>);
    render(<AuditSection />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText('需要审计权限')).toBeInTheDocument();
    });
    expect(screen.getByText(/未收到身份头/)).toBeInTheDocument();
  });

  it('renders an empty state and explains the self-scope for an L2 auditor', async () => {
    mockedUseAuditEvents.mockReturnValue({
      data: { success: true, events: [], scope: 'self' } as AuditEventsResponse,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAuditEvents>);
    render(<AuditSection />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText('暂无审计事件')).toBeInTheDocument();
    });
    expect(screen.getByText(/限定为你本人执行/)).toBeInTheDocument();
  });

  it('renders audit events with actor, entity, action and severity', async () => {
    mockedUseAuditEvents.mockReturnValue({
      data: {
        success: true,
        events: [
          {
            id: 'audit-1',
            timestamp: Date.UTC(2026, 7, 25, 10, 0, 0),
            actor: 'alice',
            actor_level: 3,
            entity_type: 'worker',
            entity_name: 'w-1',
            action: 'create',
            severity: 'info',
            source_ip: '10.0.0.1',
          },
          {
            id: 'audit-2',
            timestamp: Date.UTC(2026, 7, 25, 11, 0, 0),
            actor: 'observer',
            actor_level: 1,
            entity_type: 'system',
            entity_name: 'audit-target',
            action: 'rbac.deny.delete',
            details: '权限等级 1 不允许 "delete" worker 操作',
            severity: 'warning',
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAuditEvents>);
    render(<AuditSection />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
    });
    expect(screen.getByText('拒绝：delete')).toBeInTheDocument();
    expect(screen.getByText('L3')).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole('button', { name: '详情' })[0]);
    expect(within(screen.getByRole('dialog')).getByText('10.0.0.1')).toBeInTheDocument();
    // Resource types use the same display names as resource management.
    expect(screen.getAllByText('Agent').length).toBeGreaterThan(0);
    expect(screen.getAllByText('系统').length).toBeGreaterThan(0);
  });

  it('renders the controller source badge, kind badge and team attribution (B6)', async () => {
    mockedUseAuditEvents.mockReturnValue({
      data: {
        success: true,
        source: 'controller',
        scope: 'team',
        team: 'alpha-team',
        events: [
          {
            id: 'ctrl-0',
            timestamp: Date.UTC(2026, 8, 16, 8, 0, 0),
            actor: 'ctrl-admin',
            entity_type: 'human',
            entity_name: 'h1',
            action: 'capability_grant',
            severity: 'info',
            kind: 'capability',
            team: 'alpha-team',
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAuditEvents>);
    render(<AuditSection />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText('数据源：Controller')).toBeInTheDocument();
    });
    // kind badge replaces the entity-type badge; team line is attributed.
    fireEvent.click(screen.getByRole('button', { name: '详情' }));
    expect(within(screen.getByRole('dialog')).getByText('capability')).toBeInTheDocument();
    expect(screen.getByText(/团队：alpha-team/)).toBeInTheDocument();
    // team-scoped description (appears in the header description AND the row
    // team line — assert the exact description string instead)
    expect(screen.getByText('数据源：Controller')).toBeInTheDocument();
    expect(
      screen.getByText(/你的视图限定在团队「alpha-team」/),
    ).toBeInTheDocument();
  });

  it('renders the local fallback badge plus the provenance note (B6)', async () => {
    mockedUseAuditEvents.mockReturnValue({
      data: {
        success: true,
        source: 'local',
        scope: 'all',
        note: 'Controller 不可达，显示本实例本地日志',
        events: [],
      },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAuditEvents>);
    render(<AuditSection />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText('数据源：本地日志')).toBeInTheDocument();
    });
    expect(screen.getByText('Controller 不可达，显示本实例本地日志')).toBeInTheDocument();
  });

  // ── ARCH-01 / UI-06 consistency regression ──────────────────────────────

  it('renders a skeleton (not bare text) while loading (ARCH-01)', async () => {
    mockedUseAuditEvents.mockReturnValue({
      data: undefined,
      isLoading: true,
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAuditEvents>);
    render(<AuditSection />, { wrapper: makeWrapper() });
    const status = await screen.findByRole('status', { name: '加载中' });
    expect(status.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(0);
    // The old bare-text placeholder is gone.
    expect(screen.queryByText('加载中...')).not.toBeInTheDocument();
  });

  it('renders audit rows with the shared shadcn Table primitives (UI-06)', async () => {
    mockedUseAuditEvents.mockReturnValue({
      data: {
        success: true,
        events: [
          {
            id: 'audit-1',
            timestamp: Date.UTC(2026, 7, 25, 10, 0, 0),
            actor: 'alice',
            actor_level: 3,
            entity_type: 'worker',
            entity_name: 'w-1',
            action: 'create',
            severity: 'info',
          },
        ],
      },
      isLoading: false,
      isFetching: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useAuditEvents>);
    const { container } = render(<AuditSection />, { wrapper: makeWrapper() });
    await waitFor(() => {
      expect(screen.getByText('alice')).toBeInTheDocument();
    });
    // shadcn Table marks its <table> host with data-slot="table".
    expect(container.querySelector('[data-slot="table"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="table-header"]')).toBeInTheDocument();
    expect(container.querySelector('[data-slot="table-body"]')).toBeInTheDocument();
    // No hand-rolled <table> without the shadcn wrapper.
    expect(container.querySelector('table:not([data-slot="table"])')).toBeNull();
  });
});
