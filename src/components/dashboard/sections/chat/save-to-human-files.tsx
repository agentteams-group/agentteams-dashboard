'use client';

import { createContext, useContext, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { FolderPlus, Check, Loader2, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { agentteamsApi } from '@/lib/agentteams-api';
import { humanFilesApi } from '@/lib/human-files-api';
import { mxcToDownloadUrl } from '@/lib/matrix-media';
import type { TeamResponse } from '@/lib/agentteams-api';
import { CHAT_ATTACHMENT_DIRECTORY } from '@/lib/collaboration-files';
import { useUploadCollaborationFile } from '@/hooks/use-collaboration-files';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

export const AttachmentTeamsContext = createContext<{ teams: TeamResponse[]; preferredTeam?: string }>({ teams: [] });

async function readAttachment(mediaUrl: string, homeserver: string, accessToken: string) {
  const url = mxcToDownloadUrl(mediaUrl, homeserver);
  if (!url) throw new Error('附件地址无效');
  const response = await fetch(url, { headers: mediaUrl.startsWith('mxc://') ? { Authorization: `Bearer ${accessToken}` } : {} });
  if (!response.ok) throw new Error(`附件读取失败（${response.status}）`);
  return response.blob();
}

function attachmentName(filename: string) {
  const base = filename.split(/[\\/]/).pop() || '附件';
  return base === '.' || base === '..' ? '附件' : base;
}

const ICON_ACTION = 'size-8 justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring';
const ICON_ERROR = 'absolute right-0 top-full z-10 mt-1 w-48 rounded-md border bg-popover p-2 shadow';

export function SaveToHumanFiles({ filename, mediaUrl, homeserver, iconsOnly }: { filename: string; mediaUrl: string; homeserver: string; iconsOnly?: boolean }) {
  const queryClient = useQueryClient();
  const sessionUser = useAgentTeamsStore(state => state.sessionUser);
  const userLevel = useAgentTeamsStore(state => state.userLevel);
  const { userId, accessToken } = useMatrixStore();
  const [saving, setSaving] = useState(false);
  const [savedPath, setSavedPath] = useState('');
  const [error, setError] = useState('');

  const save = async () => {
    if (saving || savedPath || !sessionUser || !userId) return;
    setSaving(true);
    setError('');
    try {
      let name = sessionUser.startsWith('@') ? sessionUser.slice(1).split(':')[0] : sessionUser;
      // Human logins return the verified Human resource name. Global Admin
      // logins may have no Human binding and need an explicit identity check.
      if (userLevel >= 3) {
        const human = (await agentteamsApi.listHumans()).find(human => human.matrixUserID === userId);
        if (!human) throw new Error('当前账号的 Human 个人文件区尚未就绪，请稍后重试');
        name = human.name;
      }
      const blob = await readAttachment(mediaUrl, homeserver, accessToken);
      const safeName = attachmentName(filename);
      const path = `聊天附件/${Date.now()}-${safeName}`;
      await humanFilesApi.uploadFile(name, path, blob, { fileName: safeName });
      setSavedPath(path);
      await queryClient.invalidateQueries({ predicate: query => (String(query.queryKey[0]).startsWith('human-files') || query.queryKey[0] === 'human-quota') && query.queryKey[1] === name });
    } catch (cause) {
      setError(`保存到我的 Human 文件区失败：${cause instanceof Error ? cause.message : '请重试'}`);
    } finally {
      setSaving(false);
    }
  };

  const label = saving ? '正在保存…' : savedPath ? '已保存到我的文件' : '保存到我的文件';
  return <div className={cn('relative text-xs', iconsOnly && 'transition-opacity motion-reduce:transition-none [@media(hover:hover)]:opacity-0 group-hover/attachment:opacity-100 group-focus-within/attachment:opacity-100')}>
    <div className={cn('flex items-center', iconsOnly ? 'gap-0.5' : 'flex-wrap gap-x-3 gap-y-1')}>
    <button type="button" onClick={event => { event.stopPropagation(); void save(); }} disabled={saving || !!savedPath || !sessionUser || !userId}
      aria-label={label} title={savedPath || '添加到个人文件区'}
      className={cn('inline-flex items-center gap-1.5 disabled:cursor-default', iconsOnly ? ICON_ACTION : 'text-primary hover:underline disabled:no-underline')}>
      {saving ? <Loader2 className="size-4 animate-spin" /> : savedPath ? <Check className="size-4 text-emerald-600" /> : <FolderPlus className="size-4" />}
      {!iconsOnly && label}
    </button>
      <SaveToTeamFiles filename={filename} mediaUrl={mediaUrl} homeserver={homeserver} iconsOnly={iconsOnly} />
    </div>
    {savedPath && <p role="status" className={iconsOnly ? 'sr-only' : 'mt-1 break-all text-muted-foreground'}>{savedPath}</p>}
    {error && <p role="alert" className={cn('mt-1 text-status-failed', iconsOnly && ICON_ERROR)}>{error}</p>}
  </div>;
}

function SaveToTeamFiles({ filename, mediaUrl, homeserver, iconsOnly }: { filename: string; mediaUrl: string; homeserver: string; iconsOnly?: boolean }) {
  const { teams, preferredTeam } = useContext(AttachmentTeamsContext);
  const { userId, accessToken } = useMatrixStore();
  const upload = useUploadCollaborationFile();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedTeam, setSavedTeam] = useState('');
  const [error, setError] = useState('');
  const target = teams.find(team => team.name === preferredTeam) ?? (teams.length === 1 ? teams[0] : undefined);
  if (teams.length === 0 || !userId) return null;

  async function save(team: TeamResponse) {
    if (saving || savedTeam) return;
    setOpen(false);
    setSaving(true);
    setError('');
    try {
      const blob = await readAttachment(mediaUrl, homeserver, accessToken);
      const file = new File([blob], attachmentName(filename), { type: blob.type });
      await upload.mutateAsync({ team: team.name, file, prefix: CHAT_ATTACHMENT_DIRECTORY });
      setSavedTeam(team.teamName || team.name);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '保存失败，请重试');
    } finally {
      setSaving(false);
    }
  }

  const label = saving ? '正在保存到团队…' : savedTeam ? `已保存到 ${savedTeam}` : '保存到团队文件区';
  const button = <button type="button" disabled={saving || !!savedTeam} aria-label={label} title={savedTeam ? label : '添加到团队文件区'}
    onClick={event => { event.stopPropagation(); if (target) void save(target); }}
    className={cn('inline-flex items-center gap-1.5 disabled:cursor-default', iconsOnly ? ICON_ACTION : 'text-primary hover:underline disabled:no-underline')}>
    {saving ? <Loader2 className="size-4 animate-spin" /> : savedTeam ? <Check className="size-4 text-emerald-600" /> : <Users className="size-4" />}
    {!iconsOnly && label}
  </button>;
  return <div className="relative">
    {target ? button : <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>{button}</PopoverTrigger>
      <PopoverContent align="end" aria-label="选择保存团队" className="w-56 space-y-1 p-2">
        {teams.map(team => <button key={team.name} type="button"
          className="block w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-muted"
          onClick={event => { event.stopPropagation(); void save(team); }}>
          {team.teamName || team.name}
        </button>)}
      </PopoverContent>
    </Popover>}
    {savedTeam && iconsOnly && <p role="status" className="sr-only">{label}</p>}
    {error && <p role="alert" className={cn('mt-1 text-status-failed', iconsOnly && ICON_ERROR)}>{error}</p>}
  </div>;
}
