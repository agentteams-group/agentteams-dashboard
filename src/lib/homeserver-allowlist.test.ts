import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  HomeserverValidationError,
  validateHomeserverUrl,
} from '@/lib/homeserver-allowlist';

describe('validateHomeserverUrl', () => {
  const originalAllowlist = process.env.MATRIX_HOMESERVER_ALLOWLIST;
  const originalBlocked = process.env.MATRIX_HOMESERVER_BLOCKED_SUFFIXES;

  beforeEach(() => {
    process.env.MATRIX_HOMESERVER_ALLOWLIST = 'matrix.org,example.com';
    process.env.MATRIX_HOMESERVER_BLOCKED_SUFFIXES = '.svc,.local';
  });

  afterEach(() => {
    if (originalAllowlist === undefined) {
      delete process.env.MATRIX_HOMESERVER_ALLOWLIST;
    } else {
      process.env.MATRIX_HOMESERVER_ALLOWLIST = originalAllowlist;
    }
    if (originalBlocked === undefined) {
      delete process.env.MATRIX_HOMESERVER_BLOCKED_SUFFIXES;
    } else {
      process.env.MATRIX_HOMESERVER_BLOCKED_SUFFIXES = originalBlocked;
    }
  });

  it('accepts allowlisted https host', () => {
    const out = validateHomeserverUrl('https://matrix.org');
    expect(out.hostname).toBe('matrix.org');
  });

  it('rejects non-allowlisted host', () => {
    expect(() => validateHomeserverUrl('https://attacker.example')).toThrow(HomeserverValidationError);
  });

  it('accepts http to an allowlisted host (dev mode)', () => {
    const out = validateHomeserverUrl('http://matrix.org');
    expect(out.hostname).toBe('matrix.org');
  });

  it('rejects non-http(s) protocols', () => {
    expect(() => validateHomeserverUrl('file:///etc/passwd')).toThrow(HomeserverValidationError);
    expect(() => validateHomeserverUrl('javascript:alert(1)')).toThrow(HomeserverValidationError);
  });

  it('rejects loopback ipv4', () => {
    expect(() => validateHomeserverUrl('https://127.0.0.1')).toThrow(HomeserverValidationError);
  });

  it('rejects private rfc1918 ipv4', () => {
    expect(() => validateHomeserverUrl('https://10.0.0.1')).toThrow(HomeserverValidationError);
    expect(() => validateHomeserverUrl('https://192.168.1.1')).toThrow(HomeserverValidationError);
    expect(() => validateHomeserverUrl('https://172.16.0.1')).toThrow(HomeserverValidationError);
  });

  it('rejects link-local ipv4 (cloud metadata)', () => {
    expect(() => validateHomeserverUrl('https://169.254.169.254')).toThrow(HomeserverValidationError);
  });

  it('rejects loopback and link-local ipv6', () => {
    expect(() => validateHomeserverUrl('https://[::1]')).toThrow(HomeserverValidationError);
    expect(() => validateHomeserverUrl('https://[fe80::1]')).toThrow(HomeserverValidationError);
  });

  it('rejects blocked suffix (cluster.local)', () => {
    expect(() => validateHomeserverUrl('https://matrix.svc.cluster.local')).toThrow(HomeserverValidationError);
    expect(() => validateHomeserverUrl('https://agentteams-controller.agentteams-system.svc.cluster.local')).toThrow(
      HomeserverValidationError
    );
  });

  it('rejects malformed URL', () => {
    expect(() => validateHomeserverUrl('not a url')).toThrow(HomeserverValidationError);
  });

  it('allows private network when explicitly opted in', () => {
    const out = validateHomeserverUrl('http://127.0.0.1:8008', { allowPrivateNetwork: true });
    expect(out.hostname).toBe('127.0.0.1');
  });

  it('attaches reason to thrown error', () => {
    try {
      validateHomeserverUrl('https://192.168.1.1');
    } catch (err) {
      expect(err).toBeInstanceOf(HomeserverValidationError);
      expect((err as HomeserverValidationError).reason).toMatch(/private network/);
    }
  });

  it('requireAllowlist accepts an allowlisted host', () => {
    const out = validateHomeserverUrl('https://matrix.org', { requireAllowlist: true });
    expect(out.hostname).toBe('matrix.org');
  });

  it('requireAllowlist rejects a host outside the allowlist', () => {
    expect(() =>
      validateHomeserverUrl('https://attacker.example', { requireAllowlist: true })
    ).toThrow(HomeserverValidationError);
  });

  it('requireAllowlist without env still rejects unknown public hosts and keeps built-ins', () => {
    const saved = process.env.MATRIX_HOMESERVER_ALLOWLIST;
    delete process.env.MATRIX_HOMESERVER_ALLOWLIST;
    try {
      expect(() =>
        validateHomeserverUrl('https://attacker.example', { requireAllowlist: true })
      ).toThrow(HomeserverValidationError);
      const out = validateHomeserverUrl('https://matrix.org', { requireAllowlist: true });
      expect(out.hostname).toBe('matrix.org');
    } finally {
      if (saved === undefined) {
        delete process.env.MATRIX_HOMESERVER_ALLOWLIST;
      } else {
        process.env.MATRIX_HOMESERVER_ALLOWLIST = saved;
      }
    }
  });
});
