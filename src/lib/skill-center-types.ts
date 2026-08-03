/**
 * Skill Center types - centralized skill management for Dashboard
 */

export interface SkillEntry {
  name: string;
  description: string;
  source: 'custom' | 'nacos';
  sourceAlias?: string;
  version?: string;
  createdAt: string;
  updatedAt: string;
  fileCount: number;
}

export interface SkillListResponse {
  skills: SkillEntry[];
  total: number;
}

export interface SkillCreateResponse extends SkillEntry {
  success: boolean;
}

export interface NacosConfig {
  registryUrl: string;
  namespace: string;
  username?: string;
  password?: string;
  lastSyncAt?: string;
  lastSyncStatus?: 'success' | 'error';
  lastSyncError?: string;
}

export interface NacosConfigResponse {
  config: NacosConfig | null;
}

export interface NacosSyncResponse {
  success: boolean;
  synced: number;
  errors?: string[];
}

export interface SkillDetailResponse {
  skill: SkillEntry;
  files: string[];
}

export const SKILL_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;
export const SKILL_PACKAGE_MAX_BYTES = 64 * 1024 * 1024; // 64 MB
export const SKILLS_BUCKET = 'skills';
export const SKILLS_METADATA_PREFIX = 'skills/';
