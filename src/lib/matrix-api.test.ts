import { afterEach, describe, expect, it, vi } from 'vitest';
import { matrixApi, MatrixRequestError, getRateLimitRetryDelay } from '@/lib/matrix-api';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

function rateLimitedResponse(body: Record<string, unknown>, status = 429) {
  return vi.fn(async () => new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  }));
}

describe('MatrixRequestError', () => {
  it('exposes errcode, status and retry_after_ms from a rate-limit response', async () => {
    globalThis.fetch = rateLimitedResponse({
      errcode: 'M_LIMIT_EXCEEDED',
      error: 'Too Many Requests',
      retry_after_ms: 5000,
    }) as unknown as typeof fetch;

    const err = await matrixApi
      .sendMessage('https://hs.test', 'token', '!room:test', 'hello')
      .catch((e) => e);

    expect(err).toBeInstanceOf(MatrixRequestError);
    expect(err.errcode).toBe('M_LIMIT_EXCEEDED');
    expect(err.status).toBe(429);
    expect(err.retryAfterMs).toBe(5000);
    expect(err.isRateLimited).toBe(true);
    expect(err.message).toBe('Too Many Requests');
  });

  it('treats a plain 429 without errcode as rate limited', async () => {
    globalThis.fetch = rateLimitedResponse({ error: 'slow down' }) as unknown as typeof fetch;

    const err = await matrixApi
      .sendMessage('https://hs.test', 'token', '!room:test', 'hello')
      .catch((e) => e);

    expect(err).toBeInstanceOf(MatrixRequestError);
    expect(err.status).toBe(429);
    expect(err.isRateLimited).toBe(true);
  });

  it('does not flag non-429 errors as rate limited', async () => {
    globalThis.fetch = rateLimitedResponse(
      { errcode: 'M_FORBIDDEN', error: 'Forbidden' },
      403
    ) as unknown as typeof fetch;

    const err = await matrixApi
      .sendMessage('https://hs.test', 'token', '!room:test', 'hello')
      .catch((e) => e);

    expect(err).toBeInstanceOf(MatrixRequestError);
    expect(err.isRateLimited).toBe(false);
  });
});

describe('getRateLimitRetryDelay', () => {
  it('returns retry_after_ms when present', () => {
    const err = new MatrixRequestError('x', 'M_LIMIT_EXCEEDED', 429, 8000);
    expect(getRateLimitRetryDelay(err)).toBe(8000);
  });

  it('caps excessively long server delays to 5 minutes', () => {
    const err = new MatrixRequestError('x', 'M_LIMIT_EXCEEDED', 429, 10 * 60 * 1000);
    expect(getRateLimitRetryDelay(err)).toBe(5 * 60 * 1000);
  });

  it('falls back to a 30s default for unknown errors', () => {
    expect(getRateLimitRetryDelay(new Error('boom'))).toBe(30 * 1000);
  });
});
