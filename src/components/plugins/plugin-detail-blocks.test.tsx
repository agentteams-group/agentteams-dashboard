'use client';

import '@testing-library/jest-dom/vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { PluginDetailBlocks } from './plugin-detail-blocks';
import { useExtensionStore } from '@/lib/plugins/extension-store';
import type { DetailBlockContribution, DetailBlockProps } from '@/lib/plugins/types';

function makeBlock(id: string, entity: DetailBlockContribution['entity']): DetailBlockContribution {
  const component = ({ entity: data }: DetailBlockProps<{ name: string }>) => (
    <div>{`block for ${data.name}`}</div>
  );
  return {
    id,
    entity,
    component: component as unknown as DetailBlockContribution['component'],
  };
}

describe('PluginDetailBlocks', () => {
  beforeEach(() => {
    useExtensionStore.getState().clear();
  });
  afterEach(cleanup);

  it('renders nothing when no blocks target the entity', () => {
    const { container } = render(<PluginDetailBlocks entity="worker" data={{ name: 'w' }} />);
    expect(container.querySelector('[data-testid="plugin-detail-blocks"]')).toBeNull();
  });

  it('renders blocks registered for the entity and passes the entity through', () => {
    useExtensionStore.getState().add('detailBlocks', 'demo', makeBlock('extra', 'worker'));
    render(<PluginDetailBlocks entity="worker" data={{ name: 'worker-1' }} />);
    expect(screen.getByText('block for worker-1')).toBeInTheDocument();
  });

  it('does not render blocks registered for a different entity', () => {
    useExtensionStore.getState().add('detailBlocks', 'demo', makeBlock('team-block', 'team'));
    const { container } = render(<PluginDetailBlocks entity="worker" data={{ name: 'w' }} />);
    expect(container.querySelector('[data-testid="plugin-detail-blocks"]')).toBeNull();
  });
});
