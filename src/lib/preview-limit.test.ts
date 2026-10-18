import { afterEach, describe, expect, it } from 'vitest';
import { previewMaxBytes, previewMaxBytesLabel } from './preview-limit';

const ORIGINAL = process.env.NEXT_PUBLIC_ARTIFACT_PREVIEW_MAX_BYTES;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_ARTIFACT_PREVIEW_MAX_BYTES;
  else process.env.NEXT_PUBLIC_ARTIFACT_PREVIEW_MAX_BYTES = ORIGINAL;
});

describe('previewMaxBytes（F6.1 预览上限统一配置）', () => {
  it('默认 5MB', () => {
    delete process.env.NEXT_PUBLIC_ARTIFACT_PREVIEW_MAX_BYTES;
    expect(previewMaxBytes()).toBe(5 * 1024 * 1024);
    expect(previewMaxBytesLabel()).toBe('5MB');
  });

  it('NEXT_PUBLIC_ARTIFACT_PREVIEW_MAX_BYTES 覆盖', () => {
    process.env.NEXT_PUBLIC_ARTIFACT_PREVIEW_MAX_BYTES = String(10 * 1024 * 1024);
    expect(previewMaxBytes()).toBe(10 * 1024 * 1024);
    expect(previewMaxBytesLabel()).toBe('10MB');
  });

  it('非法值安全回退默认', () => {
    process.env.NEXT_PUBLIC_ARTIFACT_PREVIEW_MAX_BYTES = 'abc';
    expect(previewMaxBytes()).toBe(5 * 1024 * 1024);
    process.env.NEXT_PUBLIC_ARTIFACT_PREVIEW_MAX_BYTES = '-1';
    expect(previewMaxBytes()).toBe(5 * 1024 * 1024);
    expect(previewMaxBytesLabel()).toBe('5MB');
  });
});
