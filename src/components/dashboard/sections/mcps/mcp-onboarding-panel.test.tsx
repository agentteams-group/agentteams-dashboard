import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { McpOnboardingPanel } from './mcp-onboarding-panel';

afterEach(cleanup);

it('keeps setup, discovery, Agent authorization and legacy registration distinct', () => {
  render(<McpOnboardingPanel />);

  expect(screen.queryByText(/网关接入/)).toBeNull();

  fireEvent.click(screen.getByRole('button', { name: /接入服务 → 验证工具 → 授权 Agent/ }));

  expect(screen.getByText(/网关接入/)).toBeTruthy();
  expect(screen.getByText('Agent 授权')).toBeTruthy();
  expect(screen.getByText('验证工具')).toBeTruthy();
  expect(screen.getByText(/调用验证/)).toBeTruthy();
  // The guide must keep the registered/available distinction explicit (#132).
  expect(screen.getByText(/只记录外部服务地址/)).toBeTruthy();
});
