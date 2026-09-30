import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { McpOnboardingPanel } from './mcp-onboarding-panel';

afterEach(cleanup);

it('collapses by default and spells out the four independent states when expanded', () => {
  render(<McpOnboardingPanel />);

  expect(screen.queryByText(/网关接入/)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /接入与授权流程/ }));

  expect(screen.getByText(/网关接入/)).toBeTruthy();
  expect(screen.getByText(/Consumer 授权/)).toBeTruthy();
  expect(screen.getAllByText(/登记地址/).length).toBeGreaterThan(0);
  expect(screen.getByText(/调用验证/)).toBeTruthy();
  // The guide must keep the registered/available distinction explicit (#132).
  expect(screen.getByText(/已登记、已分配到 Worker、Consumer 已授权、验证通过/)).toBeTruthy();
});
