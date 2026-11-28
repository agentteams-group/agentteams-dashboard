import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import * as path from 'node:path';

const minio = vi.hoisted(() => ({
  getObject: vi.fn(),
  putObject: vi.fn(),
  removeObject: vi.fn(),
  bucket: 'skills',
}));
vi.mock('@/lib/minio-client', () => ({
  getMinioBucket: () => minio.bucket,
  createMinioClient: () => minio,
}));

import {
  clearNacosConfig,
  getNacosConfig,
  nacosConfigFilePath,
  setNacosConfig,
  type NacosConfig,
} from './skill-center-config';

const KEY = 'ab'.repeat(32);
const config: NacosConfig = {
  registryUrl: 'nacos://nacos.local:8848/public',
  namespace: 'public',
  username: 'nacos',
  password: 'must-not-appear-in-plaintext',
};
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'nacos-config-'));
  process.env.NACOS_CONFIG_FILE = path.join(dir, 'nacos.enc.json');
  process.env.AGENTTEAMS_SECRETS_MASTER_KEY = KEY;
  minio.putObject.mockReset();
  minio.getObject.mockReset();
  minio.removeObject.mockReset();
});
afterEach(async () => {
  delete process.env.NACOS_CONFIG_FILE;
  delete process.env.AGENTTEAMS_SECRETS_MASTER_KEY;
  await rm(dir, { recursive: true, force: true });
});

describe('encrypted Nacos configuration', () => {
  it('round-trips without persisting the password or master key in plaintext', async () => {
    await setNacosConfig(config);
    expect(await getNacosConfig()).toEqual(config);
    const disk = await readFile(nacosConfigFilePath(), 'utf8');
    expect(disk).not.toContain(config.password);
    expect(disk).not.toContain(KEY);
    expect(disk).not.toContain(config.registryUrl);
    expect(minio.putObject).not.toHaveBeenCalled();
  });

  it('fails closed without an environment master key', async () => {
    delete process.env.AGENTTEAMS_SECRETS_MASTER_KEY;
    await expect(setNacosConfig(config)).rejects.toThrow('AGENTTEAMS_SECRETS_MASTER_KEY');
  });

  it('rejects a wrong key and does not silently return null', async () => {
    await setNacosConfig(config);
    process.env.AGENTTEAMS_SECRETS_MASTER_KEY = 'cd'.repeat(32);
    await expect(getNacosConfig()).rejects.toThrow();
  });

  it('migrates legacy plaintext, verifies the encrypted copy, then removes MinIO', async () => {
    minio.getObject.mockResolvedValue((async function* () {
      yield Buffer.from(JSON.stringify({ nacos: config, updatedAt: 'old' }));
    })());
    minio.removeObject.mockResolvedValue(undefined);
    expect(await getNacosConfig()).toEqual(config);
    expect(minio.removeObject).toHaveBeenCalledWith('skills', 'skills/config/nacos.json');
    expect(await readFile(nacosConfigFilePath(), 'utf8')).not.toContain(config.password);
  });

  it('retains the legacy object when migration verification cannot complete', async () => {
    minio.getObject.mockResolvedValue((async function* () {
      yield Buffer.from(JSON.stringify({ nacos: config }));
    })());
    // A directory at the destination makes the atomic rename fail.
    await mkdir(nacosConfigFilePath());
    await expect(getNacosConfig()).rejects.toThrow();
    expect(minio.removeObject).not.toHaveBeenCalled();
  });

  it('returns null for a missing legacy object and clears both stores', async () => {
    minio.getObject.mockRejectedValue(Object.assign(new Error('missing'), { code: 'NoSuchKey' }));
    expect(await getNacosConfig()).toBeNull();
    await setNacosConfig(config);
    minio.removeObject.mockResolvedValue(undefined);
    await clearNacosConfig();
    await expect(stat(nacosConfigFilePath())).rejects.toMatchObject({ code: 'ENOENT' });
    expect(minio.removeObject).toHaveBeenCalled();
  });

  it('rejects oversized legacy configuration', async () => {
    minio.getObject.mockResolvedValue((async function* () {
      yield Buffer.alloc(65 * 1024, 0x20);
    })());
    await expect(getNacosConfig()).rejects.toThrow('配置过大');
  });
});
