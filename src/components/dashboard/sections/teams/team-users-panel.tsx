'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useHumans } from '@/hooks/use-agentteams-humans';
import { agentteamsApi, teamHumanMembers, type TeamResponse, type TeamHumanMember } from '@/lib/agentteams-api';
import { formatErrorMessage } from '@/lib/api-error';

export function TeamUsersPanel({ team, onChanged }: { team: TeamResponse; onChanged?: () => void }) {
  const { data: humans = [], isLoading, isError } = useHumans();
  const qc = useQueryClient();
  const explicit = teamHumanMembers(team);
  const initial = [...explicit, ...humans.filter((human) => human.accessibleTeams?.includes(team.name) && !explicit.some((member) => member.name === human.name)).map((human) => ({ name: human.name, role: 'coordinator' }))];
  const [members, setMembers] = useState<TeamHumanMember[] | null>(null);
  const [admin, setAdmin] = useState(team.admin?.name ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [saved, setSaved] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const rows = members ?? initial;
  const snapshot = JSON.stringify({ admin, members: rows });
  const membersChanged = JSON.stringify(rows) !== JSON.stringify(initial);
  const dirty = snapshot !== (saved ?? JSON.stringify({ admin: team.admin?.name ?? '', members: initial }));
  const options = humans.filter((human) => !rows.some((member) => member.name === human.name));
  const visibleRows = rows.filter((member) => `${member.name} ${humans.find((human) => human.name === member.name)?.displayName ?? ''}`.toLowerCase().includes(search.trim().toLowerCase()));

  async function save() {
    setSaving(true);
    setMessage('');
    try {
      const next = await agentteamsApi.updateTeam(team.name, {
        ...(admin !== (team.admin?.name ?? '') ? { admin: admin ? { name: admin } : null } : {}),
        ...(membersChanged ? { humanMembers: rows } : {}),
      });
      const saved = teamHumanMembers(next);
      if ((next.admin?.name ?? '') !== admin || (membersChanged && (saved.length !== rows.length || rows.some((row) => !saved.some((member) => member.name === row.name && (member.role || 'coordinator') === (row.role || 'coordinator')))))) {
        throw new Error('服务端未应用用户角色变更，请升级 Controller 后重试。');
      }
      // accessibleTeams also grants membership; remove that source when a user is removed here.
      for (const human of humans) {
        if (human.accessibleTeams?.includes(team.name) && !rows.some((member) => member.name === human.name) && human.name !== admin) {
          const latest = await agentteamsApi.getHuman(human.name);
          await agentteamsApi.updateHuman(human.name, { accessibleTeams: (latest.accessibleTeams ?? []).filter((name) => name !== team.name) });
        }
      }
      setMembers(rows);
      setSaved(snapshot);
      setMessage('用户角色已保存');
    } catch (err) {
      setMessage(formatErrorMessage(err));
    } finally {
      setSaving(false);
      void qc.invalidateQueries({ queryKey: ['agentteams-teams'] });
      void qc.invalidateQueries({ queryKey: ['agentteams-humans'] });
      onChanged?.();
    }
  }

  if (isLoading) return <p className="text-xs text-muted-foreground">正在加载用户…</p>;
  if (isError) return <p role="alert" className="text-xs text-destructive">读取用户失败，请刷新后重试。</p>;

  return <div className="space-y-3">
    <label className="grid gap-1 text-xs">Team Admin
      <select aria-label="Team Admin" className="h-10 min-w-0 rounded-md border bg-background px-2" value={admin} disabled={saving} onChange={(event) => setAdmin(event.target.value)}>
        <option value="">未设置</option>
        {admin && !humans.some((human) => human.name === admin) && <option value={admin}>{admin}</option>}
        {humans.map((human) => <option key={human.name} value={human.name}>{human.displayName || human.name} ({human.name})</option>)}
      </select>
    </label>
    <p className="text-xs text-muted-foreground">团队管理员可管理团队；协调用户可在团队中分派任务；普通用户作为团队成员加入。</p>
    <Input aria-label="搜索成员" placeholder="搜索显示名称或用户名…" value={search} onChange={(event) => setSearch(event.target.value)} />
    <div className="overflow-hidden rounded-lg border">
    <table className="w-full table-fixed text-left text-sm">
      <thead className="bg-muted/40 text-xs text-muted-foreground"><tr><th className="p-3 font-medium">成员</th><th className="w-28 p-3 font-medium">角色</th><th className="w-20 p-3 font-medium">操作</th></tr></thead>
      <tbody>{visibleRows.map((member) => <tr key={member.name} className="border-t">
      <td className="min-w-0 p-3"><p className="truncate">{humans.find((human) => human.name === member.name)?.displayName || member.name}</p><p className="truncate text-xs text-muted-foreground">{member.name}</p></td>
      <td className="p-3">
      <select aria-label={`${member.name} 的角色`} className="h-9 rounded-md border bg-background px-1 text-xs" value={member.role || 'coordinator'} disabled={saving} onChange={(event) => setMembers(rows.map((row) => row.name === member.name ? { ...row, role: event.target.value } : row))}>
        <option value="coordinator">协调用户</option><option value="member">普通用户</option>
        {member.role && !['coordinator', 'member'].includes(member.role) && <option value={member.role}>{member.role}</option>}
      </select>
      </td>
      <td className="p-2"><Button size="sm" variant="ghost" disabled={saving} aria-label={`移除用户 ${member.name}`} onClick={() => setMembers(rows.filter((row) => row.name !== member.name))}>移除</Button></td>
    </tr>)}</tbody>
    </table>
    {visibleRows.length === 0 && <p className="p-6 text-center text-sm text-muted-foreground">{search ? '没有匹配的成员' : '暂无普通成员，可在下方添加。'}</p>}
    </div>
    <select aria-label="添加用户" className="h-10 w-full rounded-md border bg-background px-2 text-xs" value="" disabled={saving || options.length === 0} onChange={(event) => setMembers([...rows, { name: event.target.value, role: 'member' }])}>
      <option value="" disabled>选择用户添加…</option>
      {options.map((human) => <option key={human.name} value={human.name}>{human.displayName || human.name} ({human.name})</option>)}
    </select>
    {message && <p role="status" className="text-xs">{message}</p>}
    <Button size="sm" disabled={!dirty || saving} onClick={() => void save()}>{saving ? '保存中…' : '保存用户角色'}</Button>
  </div>;
}
