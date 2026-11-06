import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ResourcesSection } from './resources-section';
import { useAgentTeamsStore } from '@/lib/agentteams-store';

vi.mock('./workers-section', () => ({ WorkersSection: () => <div>workers-view</div> }));
vi.mock('./teams-section', () => ({ TeamsSection: () => <div>teams-view</div> }));
vi.mock('./humans-section', () => ({ HumansSection: () => <div>humans-view</div> }));
vi.mock('./managers-section', () => ({ ManagersSection: () => <div>managers-view</div> }));

function setHash(hash: string) {
  Object.defineProperty(window, 'location', {
    writable: true,
    value: { ...window.location, hash },
  });
}

describe('ResourcesSection deep-link tabs', () => {
  beforeEach(() => {
    useAgentTeamsStore.setState({ userLevel: 3 });
    setHash('#console/resources/workers');
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it('pushes a history entry when switching tabs', () => {
    const push = vi.spyOn(window.history, 'pushState');
    render(<ResourcesSection />);

    fireEvent.click(screen.getByRole('tab', { name: '用户' }));

    expect(push).toHaveBeenCalledWith(null, '', '#console/resources/humans');
    expect(screen.getByRole('tab', { name: '用户' })).toHaveAttribute('aria-selected', 'true');
  });

  it('follows browser back/forward hash changes', () => {
    render(<ResourcesSection />);
    fireEvent.click(screen.getByRole('tab', { name: '用户' }));

    act(() => {
      setHash('#console/resources/workers');
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });

    expect(screen.getByRole('tab', { name: 'Agent' })).toHaveAttribute('aria-selected', 'true');
  });

  it('keeps user and Manager administration hidden from a Team account', async () => {
    useAgentTeamsStore.setState({ userLevel: 2 });
    setHash('#console/resources/humans');
    render(<ResourcesSection />);
    expect(screen.queryByRole('tab', { name: '用户' })).toBeNull();
    expect(screen.queryByRole('tab', { name: 'Managers' })).toBeNull();
    expect(await screen.findByText('workers-view')).toBeInTheDocument();
    expect(screen.queryByText('humans-view')).toBeNull();
  });
});
