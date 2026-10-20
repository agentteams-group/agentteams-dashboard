/**
 * Artifact inline-preview size cap (PRD F6.1).
 *
 * 1MB 硬编码曾散落两处（artifacts-section / artifact-link）；服务端流式
 * 透传本无限制，统一收敛到本配置：NEXT_PUBLIC_ARTIFACT_PREVIEW_MAX_BYTES
 * 覆盖，默认 5MB。超限文件走下载/Range，不做内联预览。知识库单块 1MB
 * 属独立机制（workspace-files），不在此列。
 */

const DEFAULT_PREVIEW_MAX_BYTES = 5 * 1024 * 1024;

export function previewMaxBytes(): number {
  const raw = process.env.NEXT_PUBLIC_ARTIFACT_PREVIEW_MAX_BYTES;
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_PREVIEW_MAX_BYTES;
}

/** 文案用：以 MB 计的可读上限（如 "5MB"）。 */
export function previewMaxBytesLabel(): string {
  const mb = previewMaxBytes() / (1024 * 1024);
  return Number.isInteger(mb) ? `${mb}MB` : `${mb.toFixed(1)}MB`;
}
