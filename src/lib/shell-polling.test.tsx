import { fireEvent, renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { ShellPollingProvider, useShellPollingInterval, useShellPollingSection } from './shell-polling';

function wrapper({ children }: { children: ReactNode }) {
  return <ShellPollingProvider>{children}</ShellPollingProvider>;
}

afterEach(() => {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('shell polling gates', () => {
  it('pauses non-chat queries in chat sections and resumes outside them', async () => {
    const { result, rerender } = renderHook(({ section }) => {
      useShellPollingSection(section);
      return useShellPollingInterval(['agentteams-workers'], 60_000);
    }, { wrapper, initialProps: { section: 'overview' } });

    await waitFor(() => expect(result.current).toBe(60_000));
    rerender({ section: 'chat' });
    await waitFor(() => expect(result.current).toBe(false));
    rerender({ section: 'files' });
    await waitFor(() => expect(result.current).toBe(60_000));
  });

  it('allows chat-room access only in chat sections', async () => {
    const { result, rerender } = renderHook(({ section }) => {
      useShellPollingSection(section);
      return useShellPollingInterval(['chat-room-access', 'home', 'user'], 15_000);
    }, { wrapper, initialProps: { section: 'overview' } });

    await waitFor(() => expect(result.current).toBe(false));
    rerender({ section: 'my-teams' });
    await waitFor(() => expect(result.current).toBe(15_000));
  });

  it('pauses every shell interval while the document is hidden', async () => {
    const { result } = renderHook(() => {
      useShellPollingSection('overview');
      return useShellPollingInterval(['agentteams-health'], 15_000);
    }, { wrapper });
    await waitFor(() => expect(result.current).toBe(15_000));

    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    fireEvent(document, new Event('visibilitychange'));
    await waitFor(() => expect(result.current).toBe(false));
  });
});
