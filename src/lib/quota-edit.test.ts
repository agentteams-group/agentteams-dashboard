import { describe, expect, it } from 'vitest';
import {
  bytesToQuotaInput,
  formatQuotaValue,
  quotaExactText,
  quotaFormToPayload,
  quotaFormValid,
  quotaInputNumber,
  quotaToForm,
  quotaValueToBytes,
} from './quota-edit';

describe('quota-edit', () => {
  it('converts decimal MB/GB to bytes', () => {
    expect(quotaValueToBytes(1.5, 'GB')).toBe(1_500_000_000);
    expect(quotaValueToBytes(800, 'MB')).toBe(800_000_000);
    expect(quotaValueToBytes(0, 'MB')).toBe(0);
    expect(quotaValueToBytes(null, 'GB')).toBeNull();
    expect(quotaValueToBytes(-1, 'MB')).toBeNull();
  });

  it('treats empty as unlimited and zero as zero quota', () => {
    expect(quotaToForm({ quotaBytes: null })).toEqual({
      value: null,
      unit: 'MB',
      files: null,
    });
    expect(bytesToQuotaInput(0)).toEqual({ value: 0, unit: 'MB' });
    expect(quotaFormToPayload({ value: null, unit: 'GB', files: null })).toEqual({
      quotaBytes: null,
      quotaFiles: null,
    });
    expect(quotaFormToPayload({ value: 0, unit: 'MB', files: 0 })).toEqual({
      quotaBytes: 0,
      quotaFiles: 0,
    });
  });

  it('round-trips the largest applicable unit', () => {
    expect(bytesToQuotaInput(1_500_000_000)).toEqual({ value: 1.5, unit: 'GB' });
    expect(bytesToQuotaInput(800_000_000)).toEqual({ value: 800, unit: 'MB' });
    expect(quotaToForm({ quotaBytes: 2_000_000_000, quotaFiles: 12 })).toEqual({
      value: 2,
      unit: 'GB',
      files: 12,
    });
  });

  it('formats exact text and display values', () => {
    expect(quotaExactText(1.5, 'GB')).toBe('1.5 GB = 1,500,000,000 bytes');
    expect(quotaExactText(null, 'MB')).toBe('');
    expect(formatQuotaValue(1_500_000_000)).toBe('1.5 GB');
    expect(formatQuotaValue(800_000_000)).toBe('800 MB');
    expect(formatQuotaValue(500)).toBe('500 B');
    expect(formatQuotaValue(null)).toBe('—');
  });

  it('validates the form and input numbers', () => {
    expect(quotaFormValid({ value: 1, unit: 'MB', files: 2 })).toBe(true);
    expect(quotaFormValid({ value: -1, unit: 'MB', files: null })).toBe(false);
    expect(quotaFormValid({ value: 1, unit: 'MB', files: 1.5 })).toBe(false);
    expect(quotaInputNumber(Number.NaN)).toBeNull();
    expect(quotaInputNumber(0)).toBe(0);
  });
});
