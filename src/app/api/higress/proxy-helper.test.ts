import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  getHigressConsoleURL,
  HigressConsoleConfigurationError,
  validateHigressConsoleURL,
  isFallbackConfigWriteEnabled,
  prepareAiRoutePayload,
} from './proxy-helper';

describe('Higress Console proxy configuration', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('accepts a configured Console URL with an exact allowed host', () => {
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
    vi.stubEnv('AGENTTEAMS_AI_GATEWAY_ADMIN_URL', 'https://console.example.test/api');
    vi.stubEnv('AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS', 'console.example.test');

    expect(getHigressConsoleURL()).toBe('https://console.example.test/api');
  });

  it('rejects a configured Console URL whose host is absent from the allowlist', () => {
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');
    vi.stubEnv('AGENTTEAMS_AI_GATEWAY_ADMIN_URL', 'https://console.example.test');
    vi.stubEnv('AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS', 'other.example.test');

    expect(() => getHigressConsoleURL()).toThrow(HigressConsoleConfigurationError);
  });

  it('requires both Console configuration values in external mode', () => {
    vi.stubEnv('AGENTTEAMS_HIGRESS_ADAPTER_MODE', 'external');

    expect(() => getHigressConsoleURL()).toThrow('AGENTTEAMS_AI_GATEWAY_ADMIN_URL must be configured');

    vi.stubEnv('AGENTTEAMS_AI_GATEWAY_ADMIN_URL', 'https://console.example.test');
    expect(() => getHigressConsoleURL()).toThrow('AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS must list the Console host');
  });

  it('accepts the auto-detected Controller Console URL in direct mode', () => {
    vi.stubEnv('AGENTTEAMS_AI_GATEWAY_ADMIN_URL', 'http://agentteams-controller:8001');

    expect(getHigressConsoleURL()).toBe('http://agentteams-controller:8001/');
  });

  it('rejects suffix matches and unsupported protocols', () => {
    vi.stubEnv('AGENTTEAMS_AI_GATEWAY_ADMIN_ALLOWED_HOSTS', 'console.example.test');

    expect(() => validateHigressConsoleURL('https://nested.console.example.test')).toThrow(HigressConsoleConfigurationError);
    expect(() => validateHigressConsoleURL('file:///tmp/console')).toThrow(HigressConsoleConfigurationError);
  });

  it('strips fallbackConfig unless the fixed Console capability is enabled', async () => {
    expect(isFallbackConfigWriteEnabled()).toBe(false);
    expect(prepareAiRoutePayload({ name: 'chat', fallbackConfig: { maxRetries: 2 } })).toEqual({ name: 'chat' });

    vi.stubEnv('AGENTTEAMS_HIGRESS_FALLBACK_CONFIG_WRITE_ENABLED', 'true');
    vi.resetModules();
    const helper = await import('./proxy-helper');
    expect(helper.isFallbackConfigWriteEnabled()).toBe(true);
    expect(helper.prepareAiRoutePayload({ name: 'chat', fallbackConfig: { maxRetries: 2 } })).toEqual({ name: 'chat', fallbackConfig: { maxRetries: 2 } });
  });
});
