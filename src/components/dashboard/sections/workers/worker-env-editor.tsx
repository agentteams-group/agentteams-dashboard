'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export function validateEnvRows(rows: [string, string][]): string | null {
  const names = new Set<string>();
  for (const [name, value] of rows) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return '变量名须以字母或下划线开头，只能包含字母、数字、下划线。';
    if (names.has(name)) return '变量名不能重复。';
    if (value.includes('\0')) return '变量值不能包含 NUL 字符。';
    names.add(name);
  }
  return null;
}

export function WorkerEnvEditor({ value, onChange, onValidityChange }: {
  value: Record<string, string>;
  onChange: (_env: Record<string, string>) => void;
  onValidityChange: (_valid: boolean) => void;
}) {
  const [rows, setRows] = useState<[string, string][]>(Object.entries(value));
  const error = validateEnvRows(rows);
  function update(next: [string, string][]) {
    setRows(next);
    const valid = !validateEnvRows(next);
    onValidityChange(valid);
    if (valid) onChange(Object.fromEntries(next));
  }
  return <div className="space-y-2">
    <p className="text-xs text-muted-foreground">修改环境变量会重建托管 Worker 容器，可能中断当前任务；持久化工作区保留。非托管 Worker 需由运行方手动更新进程环境。系统已设置的变量优先，不应在这里覆盖。值可能含密钥，请勿截图分享。</p>
    {rows.map(([name, val], index) => <div className="flex items-start gap-2" key={index}>
      <Input aria-label={`变量名 ${index + 1}`} value={name} onChange={(event) => update(rows.map((row, i) => i === index ? [event.target.value, row[1]] : row))} />
      <textarea aria-label={`变量值 ${index + 1}`} className="min-w-0 flex-1 rounded border p-2 text-sm" value={val} onChange={(event) => update(rows.map((row, i) => i === index ? [row[0], event.target.value] : row))} />
      <Button type="button" variant="outline" onClick={() => update(rows.filter((_, i) => i !== index))}>删除</Button>
    </div>)}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <Button type="button" variant="outline" onClick={() => update([...rows, ['', '']])}>添加环境变量</Button>
  </div>;
}
