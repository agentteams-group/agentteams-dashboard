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

  it('never allows the cloud metadata range, even with allowPrivateNetwork', () => {
    expect(() =>
      validateHomeserverUrl('https://169.254.169.254', { allowPrivateNetwork: true })
    ).toThrow(/cloud metadata/);
    expect(() =>
      validateHomeserverUrl('https://169.254.1.1', { allowPrivateNetwork: true })
    ).toThrow(/cloud metadata/);
  });

  it('rejects IPv6 unique-local (ULA) and IPv4-mapped private ranges', () => {
    expect(() => validateHomeserverUrl('https://[fd00::1]')).toThrow(HomeserverValidationError);
    expect(() => validateHomeserverUrl('https://[fc00::abcd]')).toThrow(HomeserverValidationError);
    expect(() => validateHomeserverUrl('https://[::]')).toThrow(HomeserverValidationError);
    expect(() => validateHomeserverUrl('https://[::ffff:10.0.0.1]')).toThrow(HomeserverValidationError);
    expect(() => validateHomeserverUrl('https://[::ffff:192.168.1.1]')).toThrow(HomeserverValidationError);
  });

  it('rejects reserved and multicast IPv4 ranges', () => {
    expect(() => validateHomeserverUrl('https://0.0.0.0')).toThrow(HomeserverValidationError);
    expect(() => validateHomeserverUrl('https://224.0.0.1')).toThrow(HomeserverValidationError);
    expect(() => validateHomeserverUrl('https://240.0.0.1')).toThrow(HomeserverValidationError);
  });

  it('normalizes hostname case and strips IPv6 brackets before checks', () => {
    // Uppercase allowlisted host still matches (URL hostname lowercased).
    expect(validateHomeserverUrl('https://MATRIX.ORG').hostname).toBe('matrix.org');
    // Bracketed IPv6 loopback hits the loopback rejection after stripping.
    expect(() => validateHomeserverUrl('https://[::1]:8008')).toThrow(HomeserverValidationError);
  });

  it('env allowlist entries are trimmed and lowercased', () => {
    process.env.MATRIX_HOMESERVER_ALLOWLIST = '  Matrix.Org , EXAMPLE.com  ';
    try {
      expect(validateHomeserverUrl('https://matrix.org').hostname).toBe('matrix.org');
      expect(validateHomeserverUrl('https://example.com').hostname).toBe('example.com');
      expect(() => validateHomeserverUrl('https://other.example')).toThrow(HomeserverValidationError);
    } finally {
      process.env.MATRIX_HOMESERVER_ALLOWLIST = 'matrix.org,example.com';
    }
  });

  it('an allowlisted host bypasses blocked-suffix checks (explicit trust)', () => {
    // '.local' is in the default blocked suffixes, but an explicit allowlist
    // entry is trusted before those checks run.
    process.env.MATRIX_HOMESERVER_ALLOWLIST = 'matrix.org,example.com,my.matrix.local';
    try {
      expect(validateHomeserverUrl('https://my.matrix.local').hostname).toBe('my.matrix.local');
    } finally {
      process.env.MATRIX_HOMESERVER_ALLOWLIST = 'matrix.org,example.com';
    }
  });
});
