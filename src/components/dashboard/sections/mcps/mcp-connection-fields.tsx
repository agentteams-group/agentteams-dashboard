'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import type { McpConnection, McpFixedParameter, McpRestTool } from '@/lib/mcp-management';
import { mcpManagementApi } from '@/lib/mcp-management-api';

export const mcpSelectClass = 'h-10 w-full min-w-0 rounded-md border bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring';

function FixedParameters({ label, rows, onChange }: { label: string; rows: McpFixedParameter[]; onChange: (_rows: McpFixedParameter[]) => void }) {
  return <div className="space-y-3">
    <div className="flex items-center justify-between"><p className="text-sm font-medium">{label}</p><Button type="button" variant="ghost" size="sm" onClick={() => onChange([...rows, { name: '', value: '' }])}>添加参数</Button></div>
    {rows.map((row, index) => <div key={index} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)_auto] items-start gap-2">
      <Input aria-label={`${label} 名称 ${index + 1}`} placeholder={label === 'Header' ? 'X-Tenant-Id' : 'region'} value={row.name} onChange={(e) => onChange(rows.map((r, i) => i === index ? { ...r, name: e.target.value } : r))} />
      <div className="space-y-1.5"><Input aria-label={`${label} 值 ${index + 1}`} type={row.secret ? 'password' : 'text'} autoComplete="off" placeholder={row.configured ? '已保存，留空保持原值' : '参数值'} value={row.value} onChange={(e) => onChange(rows.map((r, i) => i === index ? { ...r, value: e.target.value } : r))} />
        <label className="flex items-center gap-1.5 text-xs text-muted-foreground"><input type="checkbox" checked={Boolean(row.secret)} onChange={(e) => onChange(rows.map((r, i) => i === index ? { ...r, secret: e.target.checked } : r))} />敏感值</label>
      </div>
      <Button type="button" variant="ghost" size="sm" aria-label={`移除 ${label} 参数 ${index + 1}`} onClick={() => onChange(rows.filter((_, i) => i !== index))}>移除</Button>
    </div>)}
    {!rows.length && <p className="text-xs text-muted-foreground">未设置附加{label === 'Header' ? '请求头' : '查询参数'}</p>}
  </div>;
}

export function McpConnectionFields({ value: c, onChange }: { value: McpConnection; onChange: (_value: McpConnection) => void }) {
  const [advanced, setAdvanced] = useState(Boolean(c.headers.length || c.query.length));
  const update = (patch: Partial<McpConnection>) => onChange({ ...c, ...patch });
  const db = c.database ?? { type: 'MYSQL' as const, host: '', port: 3306, username: '', password: '', dbname: '' };
  if (c.kind === 'database') return <div className="grid gap-4 sm:grid-cols-2">
    <div className="space-y-2"><Label htmlFor="mcp-db-type">数据库类型</Label><select id="mcp-db-type" className={mcpSelectClass} value={db.type} onChange={(e) => update({ database: { ...db, type: e.target.value as typeof db.type, port: e.target.value === 'MYSQL' ? 3306 : e.target.value === 'POSTGRESQL' ? 5432 : 9000 } })}><option value="MYSQL">MySQL</option><option value="POSTGRESQL">PostgreSQL</option><option value="CLICKHOUSE">ClickHouse</option></select></div>
    <div className="space-y-2"><Label htmlFor="mcp-db-name">数据库名称</Label><Input id="mcp-db-name" value={db.dbname} onChange={(e) => update({ database: { ...db, dbname: e.target.value } })} placeholder="数据库名称" /></div>
    <div className="space-y-2"><Label htmlFor="mcp-db-host">数据库主机</Label><Input id="mcp-db-host" value={db.host} onChange={(e) => update({ database: { ...db, host: e.target.value } })} placeholder="db.example.com" /></div>
    <div className="space-y-2"><Label htmlFor="mcp-db-port">端口</Label><Input id="mcp-db-port" type="number" value={db.port} onChange={(e) => update({ database: { ...db, port: Number(e.target.value) } })} /></div>
    <div className="space-y-2"><Label htmlFor="mcp-db-user">用户名</Label><Input id="mcp-db-user" value={db.username} autoComplete="off" onChange={(e) => update({ database: { ...db, username: e.target.value } })} /></div>
    <div className="space-y-2"><Label htmlFor="mcp-db-password">密码</Label><Input id="mcp-db-password" type="password" value={db.password ?? ''} autoComplete="new-password" placeholder={db.configured ? '已保存，留空保持原值' : '数据库密码'} onChange={(e) => update({ database: { ...db, password: e.target.value } })} /></div>
    <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">使用网关能够访问的数据库地址，并确认网关已开启数据库 MCP 能力。工具由网关生成，启用后可查看工具列表和配置 Agent 授权。</p>
  </div>;
  return <div className="space-y-5">
    <div className={`grid gap-4 ${c.kind === 'proxy' ? 'sm:grid-cols-[minmax(0,1fr)_190px]' : ''}`}>
      <div className="space-y-2"><Label htmlFor="mcp-backend-url">{c.kind === 'proxy' ? '后端 MCP 地址' : 'API 基础地址'}</Label><Input id="mcp-backend-url" value={c.backendUrl} onChange={(e) => update({ backendUrl: e.target.value })} placeholder={c.kind === 'proxy' ? 'https://mcp.example.com/mcp' : 'https://api.example.com'} /><p className="text-xs text-muted-foreground">填写后端地址；系统会生成供 Agent 使用的网关地址。</p></div>
      {c.kind === 'proxy' && <div className="space-y-2"><Label htmlFor="mcp-transport">后端协议</Label><select id="mcp-transport" className={mcpSelectClass} value={c.transport} onChange={(e) => update({ transport: e.target.value as McpConnection['transport'] })}><option value="streaminghttp">Streamable HTTP</option><option value="sse">SSE（旧版）</option></select></div>}
    </div>
    <div className="space-y-4 rounded-lg border bg-muted/15 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm font-medium">后端认证</p><p className="mt-1 text-xs text-muted-foreground">网关访问后端时使用，与 Agent 的网关凭证分开管理。</p></div><select aria-label="后端认证方式" className={`${mcpSelectClass} sm:w-40`} value={c.auth.type} onChange={(e) => update({ auth: { type: e.target.value as McpConnection['auth']['type'], in: 'header', name: 'X-API-Key' } })}><option value="none">无需认证</option><option value="bearer">Bearer Token</option><option value="api-key">API Key</option><option value="basic">Basic Auth</option></select></div>
      {c.auth.type !== 'none' && <div className="grid gap-3 sm:grid-cols-2">
        {c.auth.type === 'basic' && <div className="space-y-2"><Label htmlFor="mcp-auth-username">用户名</Label><Input id="mcp-auth-username" autoComplete="off" value={c.auth.username ?? ''} onChange={(e) => update({ auth: { ...c.auth, username: e.target.value } })} /></div>}
        {c.auth.type === 'api-key' && <><div className="space-y-2"><Label htmlFor="mcp-auth-location">参数位置</Label><select id="mcp-auth-location" className={mcpSelectClass} value={c.auth.in ?? 'header'} onChange={(e) => update({ auth: { ...c.auth, in: e.target.value as 'header' | 'query' } })}><option value="header">Header</option><option value="query">Query</option></select></div><div className="space-y-2"><Label htmlFor="mcp-auth-name">参数名</Label><Input id="mcp-auth-name" value={c.auth.name ?? 'X-API-Key'} onChange={(e) => update({ auth: { ...c.auth, name: e.target.value } })} /></div></>}
        <div className={`space-y-2 ${c.auth.type !== 'basic' ? 'sm:col-span-2' : ''}`}><Label htmlFor="mcp-auth-secret">{c.auth.type === 'basic' ? '密码' : c.auth.type === 'bearer' ? 'Token' : 'API Key'}</Label><Input id="mcp-auth-secret" type="password" autoComplete="new-password" value={c.auth.secret ?? ''} placeholder={c.auth.configured ? '已保存，留空保持原值' : c.auth.type === 'bearer' ? '只填写 Token，无需 Bearer 前缀' : '填写凭证'} onChange={(e) => update({ auth: { ...c.auth, secret: e.target.value } })} /></div>
      </div>}
    </div>
    <div className="border-t pt-2"><button type="button" className="flex w-full items-center justify-between py-2 text-sm font-medium" aria-expanded={advanced} onClick={() => setAdvanced(!advanced)}>高级配置<span className="text-xs font-normal text-muted-foreground">Header、Query、超时 {advanced ? '−' : '+'}</span></button>
      {advanced && <div className="space-y-5 pt-3"><FixedParameters label="Header" rows={c.headers} onChange={(headers) => update({ headers })} /><FixedParameters label="Query" rows={c.query} onChange={(query) => update({ query })} /><div className="max-w-xs space-y-2"><Label htmlFor="mcp-timeout">验证超时（毫秒）</Label><Input id="mcp-timeout" type="number" min={1000} max={30000} value={c.timeout} onChange={(e) => update({ timeout: Number(e.target.value) })} /></div></div>}
    </div>
  </div>;
}

export function McpRestToolsEditor({ value: c, onChange }: { value: McpConnection; onChange: (_c: McpConnection) => void }) {
  const [mode, setMode] = useState(c.rawConfig ? 'yaml' : 'visual');
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState('');
  const updateTool = (index: number, patch: Partial<McpRestTool>) => onChange({ ...c, tools: c.tools.map((tool, i) => i === index ? { ...tool, ...patch } : tool) });
  async function importFile(file: File) {
    setImporting(true); setError('');
    try { const result = await mcpManagementApi.importOpenApi(await file.text()); onChange({ ...c, rawConfig: result.rawConfig }); setMode('yaml'); }
    catch (e) { setError(e instanceof Error ? e.message : '导入失败。'); }
    finally { setImporting(false); }
  }
  return <div className="space-y-4 border-t pt-5">
    <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-sm font-medium">API 工具</p><p className="mt-1 text-xs text-muted-foreground">定义 Agent 能调用的 API 和参数位置。</p></div><div className="flex gap-2"><Button type="button" variant="ghost" size="sm" onClick={() => setMode(mode === 'yaml' ? 'visual' : 'yaml')}>{mode === 'yaml' ? '可视化配置' : '高级 YAML'}</Button><label className="inline-flex h-8 cursor-pointer items-center rounded-md border px-3 text-xs hover:bg-muted">{importing ? '正在导入…' : '导入 OpenAPI'}<input className="sr-only" type="file" accept=".json,.yaml,.yml" disabled={importing} onChange={(e) => { if (e.target.files?.[0]) void importFile(e.target.files[0]); e.target.value = ''; }} /></label></div></div>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {mode === 'yaml' ? <div className="space-y-2"><Label htmlFor="mcp-tools-yaml">工具 YAML</Label><Textarea id="mcp-tools-yaml" value={c.rawConfig ?? ''} onChange={(e) => onChange({ ...c, rawConfig: e.target.value })} className="min-h-56 font-mono text-xs" placeholder={'tools:\n  - name: search\n    description: 搜索资料\n    args: []\n    requestTemplate:\n      method: GET\n      url: https://api.example.com/search'} /><p className="text-xs text-muted-foreground">填写 tools 定义；非空时以 YAML 为准。凭证及固定参数在连接配置中统一填写。</p></div> : <>
      {c.rawConfig && <p className="text-xs text-amber-700">已导入 YAML。修改可视化配置会替换导入内容。<button type="button" className="ml-2 underline" onClick={() => onChange({ ...c, rawConfig: '' })}>改用可视化配置</button></p>}
      {c.tools.map((tool, index) => <div key={index} className="space-y-3 rounded-lg border p-4">
        <div className="flex items-center justify-between"><p className="text-xs font-medium text-muted-foreground">工具 {index + 1}</p><Button type="button" variant="ghost" size="sm" onClick={() => onChange({ ...c, tools: c.tools.filter((_, i) => i !== index) })}>移除工具</Button></div>
        <div className="grid gap-3 sm:grid-cols-2"><div className="space-y-2"><Label htmlFor={`tool-name-${index}`}>工具名称</Label><Input id={`tool-name-${index}`} value={tool.name} placeholder="search_documents" onChange={(e) => updateTool(index, { name: e.target.value })} /></div><div className="space-y-2"><Label htmlFor={`tool-description-${index}`}>工具说明</Label><Input id={`tool-description-${index}`} value={tool.description} placeholder="用于查找项目文档" onChange={(e) => updateTool(index, { description: e.target.value })} /></div></div>
        <div className="grid grid-cols-[100px_minmax(0,1fr)] gap-3"><div className="space-y-2"><Label htmlFor={`tool-method-${index}`}>方法</Label><select id={`tool-method-${index}`} className={mcpSelectClass} value={tool.method} onChange={(e) => updateTool(index, { method: e.target.value as McpRestTool['method'] })}>{['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map((m) => <option key={m}>{m}</option>)}</select></div><div className="space-y-2"><Label htmlFor={`tool-path-${index}`}>API 路径</Label><Input id={`tool-path-${index}`} value={tool.path} placeholder="/documents/{id}" onChange={(e) => updateTool(index, { path: e.target.value })} /></div></div>
        <div className="space-y-2"><div className="flex items-center justify-between"><p className="text-xs font-medium">调用参数</p><Button type="button" variant="ghost" size="sm" onClick={() => updateTool(index, { parameters: [...tool.parameters, { name: '', type: 'string', position: tool.method === 'GET' ? 'query' : 'body', required: true }] })}>添加调用参数</Button></div>
          {tool.parameters.map((p, pi) => { const change = (patch: Partial<typeof p>) => updateTool(index, { parameters: tool.parameters.map((old, i) => i === pi ? { ...old, ...patch } : old) }); return <div key={pi} className="grid grid-cols-2 items-center gap-2 sm:grid-cols-[minmax(0,1fr)_100px_100px_auto_auto]"><Input aria-label={`工具 ${index + 1} 参数 ${pi + 1} 名称`} placeholder="参数名" value={p.name} onChange={(e) => change({ name: e.target.value })} /><select aria-label={`工具 ${index + 1} 参数 ${pi + 1} 类型`} className={mcpSelectClass} value={p.type} onChange={(e) => change({ type: e.target.value as typeof p.type })}>{['string', 'number', 'boolean', 'object', 'array'].map((t) => <option key={t}>{t}</option>)}</select><select aria-label={`工具 ${index + 1} 参数 ${pi + 1} 位置`} className={mcpSelectClass} value={p.position} onChange={(e) => change({ position: e.target.value as typeof p.position })}>{['query', 'path', 'header', 'body'].map((t) => <option key={t}>{t}</option>)}</select><label className="flex items-center gap-1 text-xs"><input type="checkbox" checked={p.required} onChange={(e) => change({ required: e.target.checked })} />必填</label><Button type="button" variant="ghost" size="sm" aria-label={`移除工具 ${index + 1} 参数 ${pi + 1}`} onClick={() => updateTool(index, { parameters: tool.parameters.filter((_, i) => i !== pi) })}>移除</Button></div>; })}
        </div>
      </div>)}
      <Button type="button" variant="outline" size="sm" onClick={() => onChange({ ...c, rawConfig: '', tools: [...c.tools, { name: '', description: '', method: 'GET', path: '/', parameters: [] }] })}>添加 API 工具</Button>
    </>}
  </div>;
}
