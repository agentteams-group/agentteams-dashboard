import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { ChatAuthBadge } from './chat-auth-badge';

vi.mock('./matrix-login-form', () => ({ MatrixLoginForm: () => <div /> }));

afterEach(cleanup);

const base = {
  onLogout: vi.fn(),
  onLoginClick: vi.fn(),
  showLoginDialog: false,
  onLoginDialogChange: vi.fn(),
};

describe('ChatAuthBadge compact', () => {
  it('shows one-line connection state, the local part and an icon-only logout', () => {
    render(<ChatAuthBadge {...base} isLoggedIn userId="@admin:matrix-local.test" compact />);

    expect(screen.getByText('Matrix 已连接')).toBeInTheDocument();
    expect(screen.getByText('admin')).toHaveAttribute('title', '@admin:matrix-local.test');
    expect(screen.getByRole('button', { name: '登出 Matrix' })).toBeInTheDocument();
  });

  it('logs out from the compact icon button', () => {
    const onLogout = vi.fn();
    render(<ChatAuthBadge {...base} onLogout={onLogout} isLoggedIn userId="@admin:t" compact />);

    fireEvent.click(screen.getByRole('button', { name: '登出 Matrix' }));
    expect(onLogout).toHaveBeenCalledOnce();
  });

  it('keeps the login dialog trigger when logged out', () => {
    render(<ChatAuthBadge {...base} isLoggedIn={false} userId={null} compact />);

    expect(screen.getByRole('button', { name: '登录 Matrix' })).toBeInTheDocument();
  });
});
