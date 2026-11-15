'use client';

import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { InfoTip } from '@/components/dashboard/info-tip';

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

export function WorkerEnvEditor({ value, onChange, onValidityChange, resource = 'Worker' }: {
  value: Record<string, string>;
  onChange: (_env: Record<string, string>) => void;
  onValidityChange: (_valid: boolean) => void;
  resource?: 'Worker' | 'Manager';
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
    <div className="flex items-start gap-1">
      <p className="text-xs text-muted-foreground">修改环境变量会重建托管 {resource} 容器，可能中断当前任务。</p>
      <InfoTip label="环境变量说明">
        <span className="block">持久化工作区会保留。非托管 {resource} 需由运行方手动更新进程环境。</span>
        <span className="mt-1 block">系统已设置的变量优先，不应在这里覆盖。值可能含密钥，请勿截图分享。</span>
      </InfoTip>
    </div>
    {rows.map(([name, val], index) => <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto] items-start gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,3fr)_auto]" key={index}>
      <Input aria-label={`变量名 ${index + 1}`} placeholder="变量名，如 API_KEY" value={name} onChange={(event) => update(rows.map((row, i) => i === index ? [event.target.value, row[1]] : row))} />
      <textarea aria-label={`变量值 ${index + 1}`} placeholder="变量值" rows={2} className="col-span-2 row-start-2 min-h-16 w-full min-w-0 resize-y rounded-md border border-input bg-transparent px-3 py-2 text-sm sm:col-span-1 sm:col-start-2 sm:row-start-1" value={val} onChange={(event) => update(rows.map((row, i) => i === index ? [row[0], event.target.value] : row))} />
      <Button type="button" variant="outline" className="col-start-2 row-start-1 sm:col-start-3" onClick={() => update(rows.filter((_, i) => i !== index))}>删除</Button>
    </div>)}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
    <Button type="button" variant="outline" onClick={() => update([...rows, ['', '']])}>添加环境变量</Button>
  </div>;
}
