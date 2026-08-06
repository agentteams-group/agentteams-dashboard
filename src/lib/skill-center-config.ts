/**
 * Skill Center configuration management
 * Stores Nacos registry configuration persistently in MinIO
 */

import { createMinioClient, getMinioBucket } from '@/lib/minio-client';

const CONFIG_OBJECT_KEY = 'skills/config/nacos.json';

export interface NacosConfig {
  registryUrl: string;
  namespace: string;
  alias?: string;
  protocol?: 'http' | 'https';
  apiPrefix?: string;
  mode?: 'services' | 'skills';
  username?: string;
  password?: string;
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'error';
  lastSyncError?: string;
}

export interface SkillCenterConfigData {
  nacos?: NacosConfig;
  updatedAt: string;
}

export async function getNacosConfig(): Promise<NacosConfig | null> {
  try {
    const client = createMinioClient();
    const bucket = getMinioBucket();
    if (!bucket) return null;

    const stream = await client.getObject(bucket, CONFIG_OBJECT_KEY);
    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(chunk);
    }
    const data = JSON.parse(Buffer.concat(chunks).toString('utf-8')) as SkillCenterConfigData;
    return data.nacos || null;
  } catch {
    return null;
  }
}

export async function setNacosConfig(config: NacosConfig): Promise<void> {
  const client = createMinioClient();
  const bucket = getMinioBucket();
  if (!bucket) throw new Error('MinIO 未配置');

  const data: SkillCenterConfigData = {
    nacos: config,
    updatedAt: new Date().toISOString(),
  };
  const body = JSON.stringify(data, null, 2);
  await client.putObject(bucket, CONFIG_OBJECT_KEY, body, body.length, {
    'Content-Type': 'application/json',
  });
}

export async function clearNacosConfig(): Promise<void> {
  try {
    const client = createMinioClient();
    const bucket = getMinioBucket();
    if (!bucket) return;
    await client.removeObject(bucket, CONFIG_OBJECT_KEY);
  } catch {
    // ignore
  }
}
