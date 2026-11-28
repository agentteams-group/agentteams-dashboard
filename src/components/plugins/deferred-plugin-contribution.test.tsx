import { act, cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import { DeferredPluginContribution } from './deferred-plugin-contribution';

afterEach(() => {
  cleanup();
  useExtensionStore.getState().clear();
});

describe('DeferredPluginContribution', () => {
  it('activates only when the contribution slot renders and swaps in the live component', async () => {
    const activate = vi.fn().mockResolvedValue(undefined);
    const LiveWidget = () => <div>live widget</div>;
    const Fallback = () => <div>loading widget</div>;
    render(
      <DeferredPluginContribution
        pluginId="demo"
        contributionId="status"
        point="widgets"
        fallback={Fallback}
        activate={activate}
      />,
    );

    expect(activate).toHaveBeenCalledWith('demo');
    expect(screen.getByText('loading widget')).toBeInTheDocument();

    await act(async () => {
      useExtensionStore.getState().add('widgets', 'demo', {
        id: 'status', title: 'Status', component: LiveWidget,
      });
    });
    expect(screen.getByText('live widget')).toBeInTheDocument();
  });
});
