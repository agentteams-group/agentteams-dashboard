// PII redaction — TypeScript port of AgentTeams scripts/export-debug-log.py.
// Patterns mask ID cards, phone numbers, emails, bank cards, IPs, cloud/API
// credentials, bearer tokens and generic secret key-value pairs so that
// exported debug bundles are safe to share.

interface RedactPattern {
  name: string;
  pattern: RegExp;
  // When true, capture group 1 (the key / scheme prefix) is preserved.
  keepPrefix: boolean;
}

const PII_PATTERNS: RedactPattern[] = [
  { name: 'ID_CARD', keepPrefix: false, pattern: /\b[1-9]\d{5}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]\b/g },
  { name: 'PHONE', keepPrefix: false, pattern: /(?<!\d)(?:\+?86[-\s]?)?1[3-9]\d{9}(?!\d)/g },
  { name: 'EMAIL', keepPrefix: false, pattern: /\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b/g },
  { name: 'BANK_CARD', keepPrefix: false, pattern: /\b(?:6\d{15,18}|4\d{15}|5[1-5]\d{14}|3[47]\d{13}|62\d{14,17})\b/g },
  { name: 'IP', keepPrefix: false, pattern: /\b(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\b/g },
  { name: 'ALIYUN_AK', keepPrefix: false, pattern: /\bLTAI[A-Za-z0-9]{12,30}\b/g },
  {
    name: 'ALIYUN_SK',
    keepPrefix: true,
    pattern: /((?:access_?key_?secret|secret_?access_?key)\s*[:=]\s*)(\S{20,})/gi,
  },
  { name: 'AWS_AK', keepPrefix: false, pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g },
  { name: 'OPENAI_KEY', keepPrefix: false, pattern: /\bsk-[A-Za-z0-9]{20,}\b/g },
  { name: 'ANTHROPIC_KEY', keepPrefix: false, pattern: /\bsk-ant-[A-Za-z0-9\-]{20,}\b/g },
  { name: 'DASHSCOPE_KEY', keepPrefix: false, pattern: /\bsk-sp-[A-Za-z0-9]{20,}\b/g },
  { name: 'DEEPSEEK_KEY', keepPrefix: false, pattern: /\bsk-[a-f0-9]{32,}\b/g },
  { name: 'BEARER', keepPrefix: true, pattern: /(Bearer\s+)([A-Za-z0-9\-_.]{20,})/gi },
  {
    name: 'SECRET_KV',
    keepPrefix: true,
    pattern:
      /((?:password|passwd|pwd|secret|token|access_?token|refresh_?token|id_?token|api_?key|access_?key|secret_?key|private_?key|credential|appkey|app_?secret|auth_?token|signing_?key|client_?secret|master_?key)\s*[:=]\s*)(\S+)/gi,
  },
  { name: 'JWT', keepPrefix: false, pattern: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g },
  { name: 'MATRIX_TOKEN', keepPrefix: false, pattern: /\bsyt_[A-Za-z0-9_\-]{10,}\b/g },
  { name: 'HEX_SECRET', keepPrefix: false, pattern: /\b[A-Fa-f0-9]{32,}\b/g },
  { name: 'PASSPORT', keepPrefix: false, pattern: /\b[EeGg]\d{8}\b/g },
  { name: 'SSN', keepPrefix: false, pattern: /\b\d{3}-\d{2}-\d{4}\b/g },
];

const SECRET_FIELD_PATTERN =
  /^(?:password|passwd|pwd|secret|token|access[_-]?token|refresh[_-]?token|id[_-]?token|accessToken|refreshToken|idToken|api[_-]?key|access[_-]?key(?:[_-]?secret)?|secret[_-]?access[_-]?key|secret[_-]?key|private[_-]?key|credential|app[_-]?key|app[_-]?secret|auth[_-]?token|signing[_-]?key|client[_-]?secret|master[_-]?key)$/i;

export function redactPii(text: string): string {
  if (!text) return text;
  for (const { pattern, keepPrefix } of PII_PATTERNS) {
    text = keepPrefix
      ? text.replace(pattern, '$1****')
      : text.replace(pattern, '****');
  }
  return text;
}

export function redactJsonStrings<T>(value: T): T {
  if (typeof value === 'string') {
    return redactPii(value) as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactJsonStrings(item)) as T;
  }
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
      out[key] = SECRET_FIELD_PATTERN.test(key) ? '****' : redactJsonStrings(val);
    }
    return out as T;
  }
  return value;
}
