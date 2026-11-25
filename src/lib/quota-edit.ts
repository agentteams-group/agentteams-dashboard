/**
 * quotaEdit 纯映射（无 React / window 依赖）：人员工作区配额表单。
 *
 * 单位口径（十进制，不是 MiB/GiB）：
 *   1 MB = 1,000,000 bytes，1 GB = 1,000,000,000 bytes。
 *
 * 语义：
 *   - 容量 / 文件数留空（null）= 不限（API 传 null）；
 *   - 输入 0 = 零额度（API 传 0，不是不限）；
 *   - 回显按最大适用单位（≥1 GB → GB，否则 MB），保留 1 位小数。
 * quotaFiles 为前向兼容字段：当前 Controller 只认 quotaBytes，未知字段被忽略。
 */

export type QuotaUnit = 'MB' | 'GB';

export const QUOTA_UNIT_BYTES: Record<QuotaUnit, number> = {
  MB: 1_000_000,
  GB: 1_000_000_000,
};

/** 配额表单值（null = 留空 = 不限；0 = 零额度）。 */
export interface QuotaForm {
  value: number | null;
  unit: QuotaUnit;
  files: number | null;
}

export interface QuotaLike {
  quotaBytes: number | null;
  quotaFiles?: number | null;
}

/** 共享配额视图：GET /humans/{name}/quota 的响应形态。 */
export interface QuotaView extends QuotaLike {
  usedBytes: number;
}

/** 表单输入的数值归一：非有限数 → null；0 保留（零额度）。 */
export function quotaInputNumber(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return value;
}

export function quotaFormValid(form: QuotaForm): boolean {
  const capOk =
    form.value === null || (Number.isFinite(form.value) && form.value >= 0);
  const filesOk =
    form.files === null ||
    (Number.isFinite(form.files) && form.files >= 0 && Number.isInteger(form.files));
  return capOk && filesOk;
}

/** 容量数值 + 单位 → 字节（十进制；null → null；0 → 0；四舍五入）。 */
export function quotaValueToBytes(
  value: number | null,
  unit: QuotaUnit = 'MB',
): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  return Math.round(value * QUOTA_UNIT_BYTES[unit]);
}

/** 文件数 → 整数（null → null；0 → 0；正数向下取整）。 */
export function quotaFilesValue(files: number | null): number | null {
  if (files === null || !Number.isFinite(files) || files < 0) return null;
  return Math.floor(files);
}

/** 数值格式：整数不带小数，非整数保留 1 位。 */
export function fmtQuotaNumber(value: number): string {
  if (!Number.isFinite(value)) return '—';
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

/** 字节 → 表单预填（最大适用单位；null / 非数 → 留空）。 */
export function bytesToQuotaInput(bytes: number | null | undefined): {
  value: number | null;
  unit: QuotaUnit;
} {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) {
    return { value: null, unit: 'MB' };
  }
  // 0 = 零额度（不是「不限」）：回显 0，不能落成空值。
  if (bytes === 0) return { value: 0, unit: 'MB' };
  if (bytes >= QUOTA_UNIT_BYTES.GB) {
    return { value: Math.round((bytes / QUOTA_UNIT_BYTES.GB) * 10) / 10, unit: 'GB' };
  }
  if (bytes >= QUOTA_UNIT_BYTES.MB) {
    return { value: Math.round((bytes / QUOTA_UNIT_BYTES.MB) * 10) / 10, unit: 'MB' };
  }
  return { value: Math.round((bytes / QUOTA_UNIT_BYTES.MB) * 1e6) / 1e6, unit: 'MB' };
}

/** 展示层：≥1 GB → GB、≥1 MB → MB、<1 MB → 原 bytes；null → "—"。 */
export function formatQuotaValue(bytes: number | null | undefined): string {
  if (typeof bytes !== 'number' || !Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes >= QUOTA_UNIT_BYTES.GB) {
    return `${fmtQuotaNumber(bytes / QUOTA_UNIT_BYTES.GB)} GB`;
  }
  if (bytes >= QUOTA_UNIT_BYTES.MB) {
    return `${fmtQuotaNumber(bytes / QUOTA_UNIT_BYTES.MB)} MB`;
  }
  return `${Math.round(bytes)} B`;
}

function groupThousands(n: number): string {
  const s = String(Math.trunc(Math.abs(n)));
  const sign = n < 0 ? '-' : '';
  return sign + s.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

/** 实时换算提示（例：`1.5 GB = 1,500,000,000 bytes`）；留空 → ""。 */
export function quotaExactText(value: number | null, unit: QuotaUnit): string {
  const bytes = quotaValueToBytes(value, unit);
  if (bytes === null || value === null) return '';
  return `${fmtQuotaNumber(value)} ${unit} = ${groupThousands(bytes)} bytes`;
}

/** API 配额 → 表单预填（quotaFiles 缺省 → null）。 */
export function quotaToForm(q: QuotaLike | null | undefined): QuotaForm {
  if (!q) return { value: null, unit: 'MB', files: null };
  const hit = bytesToQuotaInput(q.quotaBytes);
  return {
    value: hit.value,
    unit: hit.unit,
    files:
      typeof q.quotaFiles === 'number' && Number.isFinite(q.quotaFiles) && q.quotaFiles >= 0
        ? Math.floor(q.quotaFiles)
        : null,
  };
}

/** 表单 → PUT /humans/{name}/quota 载荷（null = 不限，0 = 零额度）。 */
export function quotaFormToPayload(form: QuotaForm): {
  quotaBytes: number | null;
  quotaFiles: number | null;
} {
  return {
    quotaBytes: quotaValueToBytes(form.value, form.unit),
    quotaFiles: quotaFilesValue(form.files),
  };
}
