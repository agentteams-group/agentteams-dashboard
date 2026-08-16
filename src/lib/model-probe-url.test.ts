import { describe, it, expect, afterEach } from 'vitest';
import { validateModelProbeBaseUrl, ModelProbeUrlError } from './model-probe-url';

const ENV_KEYS = ['MODEL_PROBE_ALLOW_HOSTS', 'MODEL_PROBE_ALLOW_PRIVATE_NETWORK'] as const;

describe('validateModelProbeBaseUrl', () => {
  const originalEnv: Record<string, string | undefined> = {};

  const setEnv = (key: string, value?: string) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };

  afterEach(() => {
    for (const key of ENV_KEYS) {
      setEnv(key, originalEnv[key]);
    }
  });

  ENV_KEYS.forEach((key) => {
    originalEnv[key] = process.env[key];
    setEnv(key, undefined);
  });

  it('accepts public https and http URLs', () => {
    expect(validateModelProbeBaseUrl('https://api.openai.com/v1').hostname).toBe('api.openai.com');
    expect(validateModelProbeBaseUrl('http://example.com:8080/v1').port).toBe('8080');
  });

  it('rejects malformed URLs and non-http protocols', () => {
    expect(() => validateModelProbeBaseUrl('not a url')).toThrow(ModelProbeUrlError);
    expect(() => validateModelProbeBaseUrl('ftp://example.com/v1')).toThrow(ModelProbeUrlError);
    expect(() => validateModelProbeBaseUrl('file:///etc/passwd')).toThrow(ModelProbeUrlError);
  });

  it('rejects loopback and private IPv4 ranges', () => {
    for (const host of ['127.0.0.1', '0.0.0.0', '10.1.2.3', '192.168.1.5', '172.16.0.1', '172.31.9.9', '169.254.169.254']) {
      expect(() => validateModelProbeBaseUrl(`http://${host}/v1`)).toThrow(ModelProbeUrlError);
    }
  });

  it('rejects private/link-local IPv6 and internal hostnames', () => {
    for (const url of [
      'http://[::1]/v1',
      'http://[fe80::1]/v1',
      'http://[fd12::1]/v1',
      'http://controller.svc/v1',
      'http://controller.svc.cluster.local/v1',
      'http://controller.cluster.local/v1',
      'http://my-host.local/v1',
      'http://localhost:11434/v1',
    ]) {
      expect(() => validateModelProbeBaseUrl(url)).toThrow(ModelProbeUrlError);
    }
  });

  it('allows public hosts that merely look internal on subdomain boundaries', () => {
    // .local must match as a suffix of a dot-separated label, not a substring.
    expect(validateModelProbeBaseUrl('https://api.myservice.io/v1').hostname).toBe('api.myservice.io');
  });

  it('allows private hosts when listed in MODEL_PROBE_ALLOW_HOSTS', () => {
    setEnv('MODEL_PROBE_ALLOW_HOSTS', 'localhost, 10.0.0.5');
    expect(validateModelProbeBaseUrl('http://localhost:11434/v1').hostname).toBe('localhost');
    expect(validateModelProbeBaseUrl('http://10.0.0.5:8000/v1').hostname).toBe('10.0.0.5');
    expect(() => validateModelProbeBaseUrl('http://10.0.0.6/v1')).toThrow(ModelProbeUrlError);
  });

  it('allows private targets when MODEL_PROBE_ALLOW_PRIVATE_NETWORK=1', () => {
    setEnv('MODEL_PROBE_ALLOW_PRIVATE_NETWORK', '1');
    expect(validateModelProbeBaseUrl('http://192.168.1.10:8000/v1').hostname).toBe('192.168.1.10');
    expect(validateModelProbeBaseUrl('http://localhost:11434/v1').hostname).toBe('localhost');
  });
});
