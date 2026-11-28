// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { nacosSyncEngine, type SyncEvent } from './nacos-sync-engine';

const { token, fetchZip } = vi.hoisted(() => ({ token: 'sync secret/+?&=xyz', fetchZip: vi.fn() }));
vi.mock('./skill-center-config', () => ({
  getNacosConfig: vi.fn().mockResolvedValue({ registryUrl: 'nacos://nacos.example.com/public', protocol: 'https' }),
}));
vi.mock('./minio-client', () => ({ createMinioClient: vi.fn() }));
vi.mock('./nacos-fetcher', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./nacos-fetcher')>();
  return {
    ...actual,
    getNacosAccessToken: vi.fn().mockResolvedValue(token),
    fetchNacosSkillZip: fetchZip,
  };
});

describe('Nacos sync event redaction (SEC-04)', () => {
  it('never emits raw or encoded tokens in failure events', async () => {
    const encoded = encodeURIComponent(token);
    fetchZip.mockRejectedValue(new Error(`failed ${token} ${encoded} ?accessToken=${encoded}`));
    const events: SyncEvent[] = [];
    const unsubscribe = nacosSyncEngine.onEvent((event) => events.push(event));
    try {
      await expect(nacosSyncEngine.syncSkill('redaction-test', '1.0.0')).rejects.toThrow();
    } finally {
      unsubscribe();
    }
    const failure = events.find((event) => event.type === 'skill-failed');
    expect(failure).toBeDefined();
    expect(failure!.message).not.toContain(token);
    expect(failure!.message).not.toContain(encoded);
    expect(failure!.message).not.toContain(encodeURIComponent(encoded));
  });
});
