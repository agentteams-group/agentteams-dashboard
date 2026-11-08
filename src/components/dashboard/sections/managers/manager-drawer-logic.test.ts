import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api-error';
import type { ManagerResponse } from '@/lib/agentteams-api';
import {
  configDraftFrom,
  dmTargetFor,
  isManagerAsleep,
  managerActionErrorText,
  managerConfigApplied,
  managerConfigDirty,
  managerConfigPayload,
  managerDocSaveBlocked,
  managerEnvApplied,
  managerSpecReadable,
  normalizeEnvDraft,
  normalizeMcpDraft,
} from './manager-drawer-logic';

describe('dmTargetFor', () => {
  it('hides the entry without an MXID', () => {
    expect(dmTargetFor(null)).toBeNull();
    expect(dmTargetFor({ matrixUserID: '   ' })).toBeNull();
    expect(dmTargetFor({})).toBeNull();
  });

  it('returns the MXID with and without a personal room', () => {
    expect(dmTargetFor({ matrixUserID: '@m:hs' })).toEqual({ mxid: '@m:hs' });
    expect(dmTargetFor({ matrixUserID: '@m:hs', roomID: '!dm:hs' })).toEqual({
      mxid: '@m:hs',
      roomId: '!dm:hs',
    });
  });
});

describe('isManagerAsleep', () => {
  it('treats Sleeping / Stopped as asleep', () => {
    expect(isManagerAsleep('Sleeping')).toBe(true);
    expect(isManagerAsleep('Stopped')).toBe(true);
    expect(isManagerAsleep('Running')).toBe(false);
    expect(isManagerAsleep(undefined)).toBe(false);
  });
});

describe('config draft', () => {
  it('projects the spec config into a draft (missing → empty)', () => {
    expect(configDraftFrom(undefined)).toEqual({
      heartbeatInterval: '',
      workerIdleTimeout: '',
      notifyChannel: '',
    });
    expect(configDraftFrom({ heartbeatInterval: '15m' })).toEqual({
      heartbeatInterval: '15m',
      workerIdleTimeout: '',
      notifyChannel: '',
    });
  });

  it('detects dirtiness ignoring surrounding whitespace', () => {
    const base = { heartbeatInterval: '15m', notifyChannel: 'admin-dm' };
    expect(managerConfigDirty(configDraftFrom(base), base)).toBe(false);
    expect(
      managerConfigDirty({ heartbeatInterval: ' 15m ', workerIdleTimeout: '', notifyChannel: 'admin-dm' }, base),
    ).toBe(false);
    expect(
      managerConfigDirty({ heartbeatInterval: '30m', workerIdleTimeout: '', notifyChannel: 'admin-dm' }, base),
    ).toBe(true);
  });

  it('trims the payload (empty = controller default)', () => {
    expect(
      managerConfigPayload({ heartbeatInterval: ' 15m ', workerIdleTimeout: '', notifyChannel: ' admin-dm ' }),
    ).toEqual({ heartbeatInterval: '15m', workerIdleTimeout: '', notifyChannel: 'admin-dm' });
  });
});

describe('managerDocSaveBlocked', () => {
  it('blocks clearing an existing document with an empty draft', () => {
    expect(managerDocSaveBlocked('', 'existing')).toBe(true);
    expect(managerDocSaveBlocked('   ', 'existing')).toBe(true);
  });

  it('allows writing content, and empty drafts when there was nothing', () => {
    expect(managerDocSaveBlocked('# new', 'existing')).toBe(false);
    expect(managerDocSaveBlocked('', '')).toBe(false);
  });
});

describe('normalizeMcpDraft', () => {
  it('rejects half-filled rows', () => {
    expect(normalizeMcpDraft([{ name: 'ctx7', url: '' }]).error).toContain('未完成行');
    expect(normalizeMcpDraft([{ name: '', url: 'http://mcp' }]).error).toContain('未完成行');
  });

  it('drops fully empty rows and trims fields', () => {
    const result = normalizeMcpDraft([
      { name: ' ctx7 ', url: ' http://mcp ', transport: ' http ' },
      { name: '  ', url: ' ' },
      { name: 'stdio-srv', url: 'http://x' },
    ]);
    expect(result.error).toBeUndefined();
    expect(result.servers).toEqual([
      { name: 'ctx7', url: 'http://mcp', transport: 'http' },
      { name: 'stdio-srv', url: 'http://x' },
    ]);
  });

  it('returns an empty list for an all-empty draft (clear all)', () => {
    expect(normalizeMcpDraft([]).servers).toEqual([]);
    expect(normalizeMcpDraft([{ name: '', url: '' }]).servers).toEqual([]);
  });
});

describe('normalizeEnvDraft', () => {
  it('requires a key when a value is present', () => {
    expect(normalizeEnvDraft([{ key: '', value: 'x' }]).error).toContain('key 必填');
    expect(normalizeEnvDraft([{ key: ' ', value: ' ' }]).env).toEqual({});
  });

  it('rejects duplicate keys and keeps empty values', () => {
    expect(normalizeEnvDraft([{ key: 'A', value: '1' }, { key: ' A ', value: '2' }]).error).toContain('重复');
    expect(normalizeEnvDraft([{ key: ' A ', value: '' }]).env).toEqual({ A: '' });
  });
});

describe('save read-back checks', () => {
  it('managerEnvApplied: controller without env → not applied', () => {
    expect(managerEnvApplied({ A: '1' }, undefined)).toBe(false);
    expect(managerEnvApplied({}, undefined)).toBe(true);
    expect(managerEnvApplied({ A: '1' }, { A: '1' })).toBe(true);
    expect(managerEnvApplied({ A: '1' }, { A: '2' })).toBe(false);
  });

  it('managerConfigApplied: trims and flags missing read-back', () => {
    const requested = { heartbeatInterval: '15m', workerIdleTimeout: '', notifyChannel: '' };
    expect(managerConfigApplied(requested, undefined)).toBe(false);
    expect(managerConfigApplied({}, undefined)).toBe(true);
    expect(managerConfigApplied(requested, { heartbeatInterval: '15m' })).toBe(true);
    expect(managerConfigApplied(requested, { heartbeatInterval: '30m' })).toBe(false);
  });
});

describe('managerSpecReadable', () => {
  it('is true only when the response carries a spec field', () => {
    const base = { name: 'm' } as unknown as ManagerResponse;
    expect(managerSpecReadable(base)).toBe(false);
    expect(managerSpecReadable(null)).toBe(false);
    expect(managerSpecReadable({ ...base, soul: '' })).toBe(true);
    expect(managerSpecReadable({ ...base, skills: [] })).toBe(true);
    expect(managerSpecReadable({ ...base, config: {} })).toBe(true);
  });
});

describe('managerActionErrorText', () => {
  it('turns 403/404/409 into readable hints', () => {
    expect(managerActionErrorText(new ApiError('forbidden', 403, '/m'))).toContain('L1 管理员权限');
    expect(managerActionErrorText(new ApiError('missing', 404, '/m'))).toContain('不存在');
    expect(managerActionErrorText(new ApiError('conflict', 409, '/m'))).toContain('冲突');
  });

  it('falls back to the shared formatter', () => {
    expect(managerActionErrorText(new ApiError('bad request', 400, '/m'))).toBe('bad request');
    expect(managerActionErrorText(new Error('boom'))).toBe('boom');
  });
});
