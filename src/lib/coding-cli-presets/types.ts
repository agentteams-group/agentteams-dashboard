export const CODING_CLI_IDS = ['qwen-code', 'opencode'] as const;
export type CodingCliId = (typeof CODING_CLI_IDS)[number];

export function isCodingCliId(value: string): value is CodingCliId {
  return (CODING_CLI_IDS as readonly string[]).includes(value);
}

export type Localized = string | { 'zh-CN': string; 'en-US'?: string };

export type Redacted = { redacted: true; has_value: boolean };

export type SettingsValue =
  | string
  | number
  | boolean
  | null
  | Redacted
  | SettingsObject
  | SettingsValue[];

export interface SettingsObject {
  [key: string]: SettingsValue;
}

export interface CodingCliProbeItem {
  id: CodingCliId;
  installed: boolean;
  version?: string;
  auth_configured?: boolean;
}

export interface InstallRequest {
  action: 'install' | 'uninstall';
  version?: string;
}

export interface InstallTask {
  task_id: string;
  status: 'running' | 'done' | 'failed';
  exit_code?: number;
  stderr?: string;
}

export interface CodingCliPreset {
  id: string;
  name: Localized;
  description?: Localized;
  settings_patch: SettingsObject;
  toolchain: {
    shared_volume?: string | null;
    install?: Localized;
    env?: Record<string, string>;
    human_confirm: boolean;
    note?: Localized | null;
  };
  mcp: {
    suggested: string[];
    human_confirm: boolean;
    note?: Localized | null;
  };
  artifacts?: { minio_path?: string; note?: string };
  arch_note?: Localized;
}

export function localizedText(value: Localized | null | undefined): string {
  if (!value) return '';
  if (typeof value === 'string') return value;
  return value['zh-CN'] || value['en-US'] || '';
}

export function isRedacted(value: unknown): value is Redacted {
  return !!value && typeof value === 'object' && (value as Redacted).redacted === true;
}
