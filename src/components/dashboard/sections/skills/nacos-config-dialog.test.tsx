import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { NacosConfigDialog } from './nacos-config-dialog';

const config = {
  registryUrl: 'nacos://nacos.example.com:8848/team-a',
  namespace: 'team-a',
  alias: '团队 Nacos',
  protocol: 'https' as const,
  apiPrefix: '/',
  mode: 'services' as const,
  username: 'admin',
  password: 'secret',
};

vi.mock('@/hooks/use-nacos-config', () => ({
  useNacosConfig: () => ({ data: config }),
  useUpdateNacosConfig: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
    isError: false,
    error: null,
  }),
  useNacosSync: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

describe('NacosConfigDialog', () => {
  afterEach(() => {
    cleanup();
  });

  it('renders saved configuration when opened', () => {
    render(<NacosConfigDialog open onOpenChange={() => {}} />);

    expect(screen.getByDisplayValue(config.registryUrl)).toBeInTheDocument();
    expect(screen.getByDisplayValue(config.alias)).toBeInTheDocument();
    expect(screen.getByDisplayValue(config.namespace)).toBeInTheDocument();
    expect(screen.getByDisplayValue(config.apiPrefix)).toBeInTheDocument();
    expect(screen.getByDisplayValue(config.username)).toBeInTheDocument();
    expect(screen.getByDisplayValue(config.password)).toBeInTheDocument();
  });
});
