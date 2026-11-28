import { describe, expect, it } from 'vitest';
import { SECURITY_HEADERS } from './security-headers';

describe('security response headers', () => {
  it('sets baseline hardening headers without exposing Next', () => {
    const headers = Object.fromEntries(SECURITY_HEADERS.map(({ key, value }) => [key, value]));
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(headers['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(headers['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(headers['Cross-Origin-Opener-Policy']).toBe('same-origin');
    expect(headers['Permissions-Policy']).toContain('camera=()');
  });

  it('keeps CSP report-only while permitting Matrix WSS, storage and WASM workers', () => {
    const csp = SECURITY_HEADERS.find(({ key }) => key === 'Content-Security-Policy-Report-Only')?.value;
    expect(csp).toBeTruthy();
    expect(csp).toContain("connect-src 'self' http: https: ws: wss:");
    expect(csp).toContain("worker-src 'self' blob:");
    expect(csp).toContain("object-src 'none'");
    expect(SECURITY_HEADERS.some(({ key }) => key === 'Content-Security-Policy')).toBe(false);
  });
});
