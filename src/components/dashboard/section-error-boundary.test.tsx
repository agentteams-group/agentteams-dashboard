import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { SectionErrorBoundary } from './section-error-boundary';

function Boom({ error }: { error: Error }): never {
  throw error;
}

describe('SectionErrorBoundary chunk self-heal', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    window.sessionStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    window.sessionStorage.clear();
    cleanup();
  });

  it('schedules exactly one reload for a chunk failure (session-first)', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, reload },
    });

    render(
      <SectionErrorBoundary sectionName="任务看板">
        <Boom error={new Error('Failed to fetch dynamically imported module')} />
      </SectionErrorBoundary>
    );

    expect(window.sessionStorage.getItem('agentteams-chunk-heal')).toBe('1');
    expect(reload).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1500);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('stays on the error card when this session already self-healed', () => {
    window.sessionStorage.setItem('agentteams-chunk-heal', '1');
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, reload },
    });

    render(
      <SectionErrorBoundary>
        <Boom error={new ChunkLoadErrorShaped()} />
      </SectionErrorBoundary>
    );

    vi.advanceTimersByTime(5000);
    expect(reload).not.toHaveBeenCalled();
  });

  it('keeps the plain error card for non-chunk errors', () => {
    const reload = vi.fn();
    Object.defineProperty(window, 'location', {
      writable: true,
      value: { ...window.location, reload },
    });

    const { getByText } = render(
      <SectionErrorBoundary sectionName="任务看板">
        <Boom error={new TypeError('Cannot read properties of undefined')}>
        </Boom>
      </SectionErrorBoundary>
    );

    expect(getByText('该模块遇到了问题')).toBeTruthy();
    expect(window.sessionStorage.getItem('agentteams-chunk-heal')).toBeNull();
    vi.advanceTimersByTime(5000);
    expect(reload).not.toHaveBeenCalled();
  });
});

class ChunkLoadErrorShaped extends Error {
  name = 'ChunkLoadError';
}
