/**
 * Skill Center configuration management
 * Stores Nacos registry configuration persistently
 */

import fs from 'fs';
import path from 'path';

export interface NacosConfig {
  registryUrl: string;
  namespace: string;
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

const CONFIG_PATH = path.join(process.cwd(), '.skill-center-config.json');

export function getNacosConfig(): NacosConfig | null {
  try {
    if (!fs.existsSync(CONFIG_PATH)) return null;
    const data = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8')) as SkillCenterConfigData;
    return data.nacos || null;
  } catch {
    return null;
  }
}

export function setNacosConfig(config: NacosConfig): void {
  const data: SkillCenterConfigData = {
    nacos: config,
    updatedAt: new Date().toISOString(),
  };
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(data, null, 2));
}

export function clearNacosConfig(): void {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      fs.unlinkSync(CONFIG_PATH);
    }
  } catch {
    // ignore
  }
}
