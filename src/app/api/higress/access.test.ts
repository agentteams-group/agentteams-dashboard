import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { requireHigressConsoleWriteAccess } from './access';
import { validateHigressSession } from '@/lib/api-auth';
import { getHigressConsoleURL } from './proxy-helper';

vi.mock('@/lib/api-auth', () => ({
  validateHigressSession: vi.fn(),
}));

vi.mock('./proxy-helper', () => ({
  getHigressConsoleURL: vi.fn(),
}));

const mockValidateHigressSession = vi.mocked(validateHigressSession);
const mockGetHigressConsoleURL = vi.mocked(getHigressConsoleURL);

describe('Higress Console write access', () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it('rejects writes when the Console deployment configuration is invalid', async () => {
    mockGetHigressConsoleURL.mockImplementation(() => {
      throw new Error('Higress Console deployment configuration error: Console host is not allowed');
    });

    const result = await requireHigressConsoleWriteAccess(
      new NextRequest('http://dashboard.test/api/higress/ai-providers', { method: 'POST' })
    );

    expect(result?.status).toBe(503);
  });

  it('rejects writes without a valid Console session', async () => {
    mockGetHigressConsoleURL.mockReturnValue('https://console.example.test');
    mockValidateHigressSession.mockResolvedValue({ valid: false, user: null });

    const result = await requireHigressConsoleWriteAccess(
      new NextRequest('http://dashboard.test/api/higress/ai-providers', { method: 'POST' })
    );

    expect(result?.status).toBe(401);
  });

  it('allows writes with valid deployment configuration and session', async () => {
    mockGetHigressConsoleURL.mockReturnValue('https://console.example.test');
    mockValidateHigressSession.mockResolvedValue({ valid: true, user: { name: 'admin', level: 3 } });

    const result = await requireHigressConsoleWriteAccess(
      new NextRequest('http://dashboard.test/api/higress/ai-providers', { method: 'POST' })
    );

    expect(result).toBeNull();
  });
});
