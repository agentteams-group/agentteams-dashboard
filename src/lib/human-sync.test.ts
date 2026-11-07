import { describe, expect, it } from 'vitest';
import {
  classifyHumanSyncError,
  humanSyncEtagLabel,
  mapHumanSyncStatus,
} from './human-sync';
import type { HumanSyncStatus } from './agentteams-api';

describe('mapHumanSyncStatus', () => {
  it('maps generation, update time, counts and the manifest ETag', () => {
    const view = mapHumanSyncStatus(
      {
        entries: 12,
        tombstones: 2,
        generation: 7,
        updatedAt: '2026-11-06T09:30:00Z',
        updatedBy: 'alice',
      },
      'W/"manifest-etag"',
    );
    expect(view).toEqual({
      kind: 'ready',
      generation: 7,
      updatedAt: '2026-11-06T09:30:00Z',
      updatedBy: 'alice',
      entries: 12,
      tombstones: 2,
      etag: 'W/"manifest-etag"',
    });
  });

  it('treats the zero summary (manifest never written) as the empty state', () => {
    const view = mapHumanSyncStatus(
      { entries: 0, tombstones: 0, generation: 0, updatedAt: '', updatedBy: '' },
      null,
    );
    expect(view).toEqual({ kind: 'empty', reason: 'no-manifest' });
  });

  it('defaults absent optional fields without inventing a generation', () => {
    const blank = mapHumanSyncStatus({} as HumanSyncStatus, null);
    expect(blank).toEqual({ kind: 'empty', reason: 'no-manifest' });
  });
});

describe('classifyHumanSyncError', () => {
  it('degrades 404 and 405 sync reads to empty states', () => {
    expect(classifyHumanSyncError(404)).toBe('no-manifest');
    expect(classifyHumanSyncError(405)).toBe('unsupported');
  });

  it('keeps every other failure an error', () => {
    expect(classifyHumanSyncError(500)).toBe('error');
    expect(classifyHumanSyncError(403)).toBe('error');
    expect(classifyHumanSyncError(undefined)).toBe('error');
  });
});

describe('humanSyncEtagLabel', () => {
  it('shows the storage ETag verbatim and a dash when absent', () => {
    expect(humanSyncEtagLabel('d41d8cd98f00b204e9800998ecf8427e')).toBe(
      'd41d8cd98f00b204e9800998ecf8427e',
    );
    expect(humanSyncEtagLabel(null)).toBe('—');
    expect(humanSyncEtagLabel('  ')).toBe('—');
  });
});
