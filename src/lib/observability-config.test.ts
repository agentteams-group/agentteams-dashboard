import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { mergeObservabilityConfig, parseOtlpHeaders, publicObservabilityConfig, readObservabilityConfig, saveObservabilityConfig, testObservabilityConnection, workerObservabilityEnv, type ObservabilityConfig } from './observability-config';

let directory: string;
const connected: ObservabilityConfig = {
  enabled: true, captureContent: true, mode: 'direct', langfuseUrl: 'http://langfuse.local', publicUrl: 'http://localhost:13100',
  projectId: 'project-a', publicKey: 'pk-a', secretKey: 'sk-private', collectorEndpoint: '', collectorHeaders: '', revision: 'one',
};
beforeEach(async () => {
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'at-observability-'));
  vi.stubEnv('DASHBOARD_CONFIG_FILE', path.join(directory, 'config.json'));
  for (const key of ['LANGFUSE_BASE_URL', 'LANGFUSE_PUBLIC_URL', 'LANGFUSE_PROJECT_ID', 'LANGFUSE_PUBLIC_KEY', 'LANGFUSE_SECRET_KEY', 'DASHBOARD_ALLOWED_HOSTS']) vi.stubEnv(key, '');
});
afterEach(async () => { await fs.rm(directory, { recursive: true, force: true }); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it('is disabled without configuration and persists secrets privately across fresh reads', async () => {
  expect(await readObservabilityConfig()).toMatchObject({ enabled: false });
  const saved = await saveObservabilityConfig(connected);
  expect(saved.revision).not.toBe('one');
  expect(await readObservabilityConfig()).toEqual(saved);
  expect((await fs.stat(path.join(directory, 'observability.json'))).mode & 0o777).toBe(0o600);
  const view = publicObservabilityConfig(saved);
  expect(view.secretKeyConfigured).toBe(true);
  expect(JSON.stringify(view)).not.toContain('sk-private');
  expect(mergeObservabilityConfig(saved, { ...view, secretKey: '' }).secretKey).toBe('sk-private');
});

it('builds standard direct OTLP config, preserves unrelated env and removes stale overrides on disable', () => {
  const env = workerObservabilityEnv(connected, { USER_SETTING: 'keep', OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://stale', OTEL_EXPORTER_OTLP_TRACES_HEADERS: 'stale' });
  expect(env).toMatchObject({ USER_SETTING: 'keep', AGENTTEAMS_OTEL_ENABLED: 'true', OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: 'http://langfuse.local/api/public/otel/v1/traces' });
  expect(parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS).Authorization).toBe('Basic ' + Buffer.from('pk-a:sk-private').toString('base64'));
  expect(env.OTEL_EXPORTER_OTLP_TRACES_HEADERS).toBe(env.OTEL_EXPORTER_OTLP_HEADERS);
  const disabled = workerObservabilityEnv({ ...connected, enabled: false }, env);
  expect(disabled).toEqual({ USER_SETTING: 'keep', AGENTTEAMS_OTEL_ENABLED: 'false', AGENTTEAMS_OTEL_CONFIG_REVISION: 'one' });
});

it('supports an existing collector without passing Langfuse credentials to that Worker', () => {
  const config = { ...connected, mode: 'collector' as const, collectorEndpoint: 'http://collector:4318', collectorHeaders: 'Authorization=Bearer%20collector-token' };
  const env = workerObservabilityEnv(config, {});
  expect(env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT).toBe('http://collector:4318/v1/traces');
  expect(parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS)).toEqual({ Authorization: 'Bearer collector-token' });
  expect(JSON.stringify(env)).not.toContain(Buffer.from('pk-a:sk-private').toString('base64'));
});

it('rejects credential-bearing URLs, metadata targets and header injection', () => {
  for (const langfuseUrl of ['file:///tmp/secret', 'http://user:secret@host', 'http://169.254.169.254', 'http://metadata.google.internal']) {
    expect(() => mergeObservabilityConfig(connected, { ...connected, langfuseUrl })).toThrow();
  }
  expect(() => mergeObservabilityConfig(connected, { ...connected, secretKey: 'bad\nvalue' })).toThrow();
  expect(() => parseOtlpHeaders('Authorization=value%0D%0AInjected%3Asecret')).toThrow();
});

it('tests project authentication and OTLP without creating fake trace spans or following redirects', async () => {
  const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ data: [{ id: 'project-a', name: 'A' }] })).mockResolvedValueOnce(Response.json({}));
  vi.stubGlobal('fetch', fetcher);
  expect(await testObservabilityConnection(connected)).toMatchObject({ projectId: 'project-a', source: 'dashboard' });
  expect(fetcher.mock.calls[1][0]).toBe('http://langfuse.local/api/public/otel/v1/traces');
  expect(JSON.parse(fetcher.mock.calls[1][1].body)).toEqual({ resourceSpans: [] });
  expect(fetcher.mock.calls.every(([, options]) => options.redirect === 'error')).toBe(true);
});

it('does not return an upstream secret-bearing error body', async () => {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('secret-upstream-body', { status: 401 })));
  await expect(testObservabilityConnection(connected)).rejects.toThrow('Langfuse 项目认证失败（HTTP 401）');
});
