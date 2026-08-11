import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { A2uiMessage } from './a2ui-message';
import type { A2uiMessage as A2uiMessageType } from '@a2ui/web_core/v0_9';

const mocks = vi.hoisted(() => ({
  processMessages: vi.fn(),
  surfacesMap: new Map<string, { id: string; kind: string }>(),
}));

vi.mock('@a2ui/web_core/v0_9', () => ({
  MessageProcessor: class {
    model = { surfacesMap: mocks.surfacesMap };
    processMessages(...args: unknown[]) {
      mocks.processMessages(...args);
    }
  },
}));

vi.mock('@a2ui/react/v0_9', () => ({
  A2uiSurface: ({ surface }: { surface: { id: string; kind: string } }) => (
    <div data-testid="a2ui-surface" data-surface-id={surface.id} />
  ),
}));

vi.mock('@/lib/a2ui/catalog', () => ({
  agentteamsChatCatalog: {},
}));

describe('A2uiMessage', () => {
  afterEach(cleanup);

  it('renders processed surfaces', () => {
    mocks.surfacesMap.clear();
    mocks.surfacesMap.set('s1', { id: 's1', kind: 'surface' });
    mocks.processMessages.mockClear();

    render(<A2uiMessage messages={[{ version: 'v0.9' }] as unknown as A2uiMessageType[]} />);

    expect(mocks.processMessages).toHaveBeenCalled();
    expect(document.querySelectorAll('[data-testid="a2ui-surface"]')).toHaveLength(1);
    expect(screen.queryByText(/解析失败/)).toBeNull();
  });

  it('degrades to a notice instead of crashing when processing throws', () => {
    mocks.processMessages.mockImplementationOnce(() => {
      throw new Error('component validation failed');
    });

    render(<A2uiMessage messages={[{ version: 'v0.9' }] as unknown as A2uiMessageType[]} />);

    expect(screen.getByText(/交互消息解析失败/)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-testid="a2ui-surface"]')).toHaveLength(0);
  });

  it('shows the raw protocol JSON in the degraded notice', () => {
    mocks.processMessages.mockImplementationOnce(() => {
      throw new Error('boom');
    });

    render(
      <A2uiMessage
        messages={[{ version: 'v0.9', createSurface: { surfaceId: 's' } }] as unknown as A2uiMessageType[]}
      />
    );

    expect(screen.getByText(/createSurface/)).toBeInTheDocument();
  });
});
