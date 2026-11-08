'use client';

// Single-field control driven by a runtime-surface declaration.
//
// 1:1 port of the workbench plugin `components/schema/SchemaField.tsx`:
//  - string / number / boolean / enum / secret
//  - array (row editor) / record (KV editor) / object (JSON textarea)
//  - sensitive values are masked: an incoming "***" or undefined sentinel
//    renders an empty control with a "keep original" placeholder and is never
//    written back unless the user re-enters a value (controller red line).
//  - two-star templates (or an explicit readOnly flag) render a read-only
//    value instead of a control.
//  - unknown/unclassified types keep editing possible via a free-form JSON
//    textarea instead of silently dropping the field.

import { useEffect, useState } from 'react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  formatFieldValue,
  isReadOnlyField,
  type SurfaceField,
} from '@/lib/runtime-surface';

const MASK = '已设置，未修改时保持原值';

function isMasked(field: SurfaceField, value: unknown): boolean {
  return field.sensitive === true && (value === '***' || value === undefined);
}

function objectText(value: unknown): string {
  if (value === undefined || value === null) return '—';
  return typeof value === 'object' ? JSON.stringify(value, null, 2) : String(value);
}

function prettyJson(value: unknown): string {
  return value === undefined || value === null ? '' : JSON.stringify(value, null, 2);
}

function coerceText(text: string): unknown {
  if (text === 'true') return true;
  if (text === 'false') return false;
  if (text !== '' && Number.isFinite(Number(text)) && String(Number(text)) === text) {
    return Number(text);
  }
  return text;
}

function AppliesBadge({ applies }: { applies: SurfaceField['applies'] }) {
  if (applies === 'next-turn') {
    return (
      <Badge variant="secondary" className="text-xs">
        下一轮生效
      </Badge>
    );
  }
  if (applies === 'restart') {
    return (
      <Badge variant="outline" className="border-red-500/40 text-xs text-red-600 dark:text-red-400">
        需重启
      </Badge>
    );
  }
  return null;
}

function ArrayEditor({
  field,
  value,
  onChange,
  disabled,
}: {
  field: SurfaceField;
  value: unknown;
  onChange: (_v: unknown) => void;
  disabled?: boolean;
}) {
  const rows = Array.isArray(value) ? value : [];
  const first =
    rows.length > 0
      ? rows[0]
      : Array.isArray(field.default) && field.default.length > 0
        ? field.default[0]
        : field.default;
  const elemType: 'number' | 'boolean' | 'string' =
    typeof first === 'number' ? 'number' : typeof first === 'boolean' ? 'boolean' : 'string';

  const setRow = (index: number, next: unknown) => {
    onChange(rows.map((row, i) => (i === index ? next : row)));
  };

  return (
    <div className="space-y-1">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-1">
          {elemType === 'number' ? (
            <Input
              type="number"
              className="h-8 text-xs"
              disabled={disabled}
              aria-label={`${field.label || field.key} 第 ${index + 1} 行`}
              value={typeof row === 'number' ? String(row) : ''}
              onChange={(event) =>
                setRow(index, event.target.value === '' ? null : Number(event.target.value))
              }
            />
          ) : elemType === 'boolean' ? (
            <Switch
              disabled={disabled}
              aria-label={`${field.label || field.key} 第 ${index + 1} 行`}
              checked={row === true}
              onCheckedChange={(checked) => setRow(index, checked)}
            />
          ) : (
            <Input
              className="h-8 text-xs"
              disabled={disabled}
              aria-label={`${field.label || field.key} 第 ${index + 1} 行`}
              value={row === undefined || row === null ? '' : String(row)}
              onChange={(event) => setRow(index, event.target.value)}
            />
          )}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            disabled={disabled}
            aria-label={`删除 ${field.label || field.key} 第 ${index + 1} 行`}
            onClick={() => onChange(rows.filter((_, i) => i !== index))}
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full text-xs"
        disabled={disabled}
        onClick={() =>
          onChange([...rows, elemType === 'number' ? null : elemType === 'boolean' ? false : ''])
        }
      >
        添加一行
      </Button>
    </div>
  );
}

function RecordEditor({
  value,
  onChange,
  disabled,
  label,
}: {
  value: unknown;
  onChange: (_v: unknown) => void;
  disabled?: boolean;
  label: string;
}) {
  const normalized =
    value && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  const [rows, setRows] = useState<Array<{ key: string; text: string }>>(() =>
    Object.entries(normalized).map(([key, v]) => ({ key, text: v === null || v === undefined ? '' : String(v) })),
  );

  useEffect(() => {
    const current = JSON.stringify(normalized);
    const next = JSON.stringify(
      Object.fromEntries(
        rows
          .filter((row) => row.key.trim() !== '')
          .map((row) => [row.key.trim(), coerceText(row.text)]),
      ),
    );
    if (current !== next) {
      setRows(
        Object.entries(normalized).map(([key, v]) => ({
          key,
          text: v === null || v === undefined ? '' : String(v),
        })),
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const commit = (next: Array<{ key: string; text: string }>) => {
    setRows(next);
    const record: Record<string, unknown> = {};
    for (const row of next) {
      const key = row.key.trim();
      if (!key) continue;
      record[key] = coerceText(row.text);
    }
    onChange(record);
  };

  return (
    <div className="space-y-1">
      {rows.map((row, index) => (
        <div key={index} className="flex items-center gap-1">
          <Input
            className="h-8 flex-[0_1_45%] text-xs"
            disabled={disabled}
            placeholder="键"
            aria-label={`${label} 键 ${index + 1}`}
            value={row.key}
            onChange={(event) =>
              commit(rows.map((x, i) => (i === index ? { ...x, key: event.target.value } : x)))
            }
          />
          <Input
            className="h-8 flex-1 text-xs"
            disabled={disabled}
            placeholder="值"
            aria-label={`${label} 值 ${index + 1}`}
            value={row.text}
            onChange={(event) =>
              commit(rows.map((x, i) => (i === index ? { ...x, text: event.target.value } : x)))
            }
          />
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-8 px-2"
            disabled={disabled}
            aria-label={`删除 ${label} 第 ${index + 1} 行`}
            onClick={() => commit(rows.filter((_, i) => i !== index))}
          >
            ×
          </Button>
        </div>
      ))}
      <Button
        type="button"
        variant="outline"
        size="sm"
        className="h-8 w-full text-xs"
        disabled={disabled}
        onClick={() => commit([...rows, { key: '', text: '' }])}
      >
        添加一行
      </Button>
    </div>
  );
}

function JsonEditor({
  value,
  onChange,
  disabled,
  error,
  masked,
}: {
  value: unknown;
  onChange: (_v: unknown) => void;
  disabled?: boolean;
  error?: string;
  masked?: boolean;
}) {
  const [text, setText] = useState(() => prettyJson(value));
  const [invalid, setInvalid] = useState(false);

  useEffect(() => {
    setText(prettyJson(value));
    setInvalid(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(value ?? null)]);

  const handle = (raw: string) => {
    setText(raw);
    try {
      const parsed = JSON.parse(raw);
      setInvalid(false);
      onChange(parsed);
    } catch {
      setInvalid(true);
    }
  };

  return (
    <div className="space-y-1">
      <Textarea
        className="min-h-[64px] font-mono text-xs"
        disabled={disabled}
        placeholder={masked ? MASK : prettyJson(value)}
        aria-label="JSON 值"
        value={text}
        onChange={(event) => handle(event.target.value)}
      />
      {invalid ? <p className="text-xs text-red-600 dark:text-red-400">JSON 格式不对</p> : null}
      {error ? <p className="text-xs text-red-600 dark:text-red-400">{error}</p> : null}
    </div>
  );
}

export function SchemaField({
  field,
  value,
  onChange,
  disabled,
  error,
  readOnly,
}: {
  field: SurfaceField;
  value: unknown;
  onChange: (_v: unknown) => void;
  disabled?: boolean;
  error?: string;
  readOnly?: boolean;
}) {
  const label = field.label || field.key;
  const masked = isMasked(field, value);
  const placeholder = masked ? MASK : undefined;

  if (readOnly || isReadOnlyField(field)) {
    const text = Array.isArray(value)
      ? value.map((v) => formatFieldValue(field, v)).join(', ')
      : formatFieldValue(field, value);
    return (
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
          <span>
            {label}
            {field.unit ? `（${field.unit}）` : ''}
          </span>
          <AppliesBadge applies={field.applies} />
          <Badge variant="secondary" className="text-xs">
            复合结构，暂不支持编辑
          </Badge>
        </div>
        <pre className="max-h-40 overflow-auto rounded-md border bg-muted/20 p-2 text-xs whitespace-pre-wrap break-all">
          {text}
        </pre>
      </div>
    );
  }

  const control = (() => {
    switch (field.type) {
      case 'string':
        if (field.enum) {
          return (
            <Select
              disabled={disabled}
              value={typeof value === 'string' ? value : undefined}
              onValueChange={(next) => onChange(next)}
            >
              <SelectTrigger className="w-full" aria-label={label}>
                <SelectValue placeholder={placeholder ?? '选择…'} />
              </SelectTrigger>
              <SelectContent>
                {field.enum.map((option) => (
                  <SelectItem key={option} value={option}>
                    {option}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          );
        }
        return (
          <Input
            className="h-9 text-sm"
            disabled={disabled}
            aria-label={label}
            aria-invalid={error ? true : undefined}
            placeholder={placeholder}
            value={masked || value === undefined || value === null ? '' : String(value)}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      case 'number':
        return (
          <Input
            type="number"
            className="h-9 text-sm"
            disabled={disabled}
            aria-label={label}
            aria-invalid={error ? true : undefined}
            placeholder={placeholder}
            value={masked || typeof value !== 'number' ? '' : String(value)}
            onChange={(event) =>
              onChange(event.target.value === '' ? null : Number(event.target.value))
            }
          />
        );
      case 'boolean':
        return (
          <Switch
            disabled={disabled}
            aria-label={label}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked)}
          />
        );
      case 'secret':
        return (
          <Input
            type="password"
            className="h-9 text-sm"
            disabled={disabled}
            aria-label={label}
            aria-invalid={error ? true : undefined}
            placeholder={placeholder}
            value={masked || value === undefined || value === null ? '' : String(value)}
            onChange={(event) => onChange(event.target.value)}
          />
        );
      case 'array':
        return <ArrayEditor field={field} value={value} onChange={onChange} disabled={disabled} />;
      case 'record':
        return <RecordEditor value={value} onChange={onChange} disabled={disabled} label={label} />;
      case 'object':
        // Sensitive objects go through as raw text; surfacePatch parses them at
        // save time so the whole value is written in one piece.
        if (field.sensitive === true) {
          return (
            <Textarea
              className="min-h-[64px] font-mono text-xs"
              disabled={disabled}
              aria-label={label}
              placeholder={placeholder}
              value={masked || value === undefined || value === null ? '' : objectText(value)}
              onChange={(event) => onChange(event.target.value)}
            />
          );
        }
        return (
          <JsonEditor
            value={value}
            onChange={onChange}
            disabled={disabled}
            error={error}
            masked={masked}
          />
        );
      // Legacy aliases (surfaces are normalized on fetch, kept for defensive
      // rendering if a caller passes an un-normalized declaration).
      case 'int':
      case 'float':
        return (
          <Input
            type="number"
            step={field.type === 'float' ? 0.1 : 1}
            className="h-9 text-sm"
            disabled={disabled}
            aria-label={label}
            placeholder={placeholder}
            value={masked || typeof value !== 'number' ? '' : String(value)}
            onChange={(event) =>
              onChange(event.target.value === '' ? null : Number(event.target.value))
            }
          />
        );
      case 'bool':
        return (
          <Switch
            disabled={disabled}
            aria-label={label}
            checked={value === true}
            onCheckedChange={(checked) => onChange(checked)}
          />
        );
      case 'enum':
        return (
          <Select
            disabled={disabled}
            value={typeof value === 'string' ? value : undefined}
            onValueChange={(next) => onChange(next)}
          >
            <SelectTrigger className="w-full" aria-label={label}>
              <SelectValue placeholder={placeholder ?? '选择…'} />
            </SelectTrigger>
            <SelectContent>
              {(field.enum ?? []).map((option) => (
                <SelectItem key={option} value={option}>
                  {option}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        );
      case 'string-list':
        return (
          <Input
            className="h-9 text-sm"
            disabled={disabled}
            aria-label={label}
            placeholder={placeholder ?? '逗号分隔'}
            value={Array.isArray(value) ? value.map((v) => String(v)).join(', ') : ''}
            onChange={(event) =>
              onChange(
                event.target.value
                  .split(',')
                  .map((part) => part.trim())
                  .filter(Boolean),
              )
            }
          />
        );
      default:
        // Unknown type: keep the field editable instead of hiding it.
        return (
          <JsonEditor
            value={value}
            onChange={onChange}
            disabled={disabled}
            error={error}
            masked={masked}
          />
        );
    }
  })();

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground">
        <span>
          {label}
          {field.unit ? `（${field.unit}）` : ''}
        </span>
        <AppliesBadge applies={field.applies} />
        {field.description ? <span className="truncate opacity-70">{field.description}</span> : null}
      </div>
      {control}
      {error && field.type !== 'object' ? (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      ) : null}
    </div>
  );
}

export default SchemaField;
