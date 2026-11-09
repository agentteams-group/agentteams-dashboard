'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Download, Check, Loader2 } from 'lucide-react';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { agentteamsApi } from '@/lib/agentteams-api';
import { humanFilesApi } from '@/lib/human-files-api';
import { mxcToDownloadUrl } from '@/lib/matrix-media';
import { ApiError } from '@/lib/api-error';

export function SaveToHumanFiles({ filename, mediaUrl, homeserver }: { filename: string; mediaUrl: string; homeserver: string }) {
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
      const name = sessionUser.startsWith('@') ? sessionUser.slice(1).split(':')[0] : sessionUser;
      // Human logins return the verified Human resource name. Global Admin
      // logins may have no Human binding and need an explicit identity check.
      if (userLevel >= 3) {
        const human = await agentteamsApi.getHuman(name).catch(cause => {
          if (cause instanceof ApiError && cause.status === 404) throw new Error('当前账号尚未绑定个人文件区，请先创建或绑定 Human');
          throw cause;
        });
        if (human.matrixUserID !== userId) throw new Error('当前账号未绑定对应的 Human 文件区');
      }
      const url = mxcToDownloadUrl(mediaUrl, homeserver);
      if (!url) throw new Error('附件地址无效');
      // Only the local Matrix proxy receives Matrix credentials.
      const response = await fetch(url, { headers: mediaUrl.startsWith('mxc://') ? { Authorization: `Bearer ${accessToken}` } : {} });
      if (!response.ok) throw new Error(`附件读取失败（${response.status}）`);
      const blob = await response.blob();
      const base = filename.split(/[\\/]/).pop() || '附件';
      const safeName = base === '.' || base === '..' ? '附件' : base;
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

  return <div className="mt-2 text-xs">
    <button type="button" onClick={event => { event.stopPropagation(); void save(); }} disabled={saving || !!savedPath || !sessionUser || !userId} title={savedPath || '保存到当前账号的 Human 文件区'} className="inline-flex items-center gap-1.5 text-primary hover:underline disabled:cursor-default disabled:no-underline">
      {saving ? <Loader2 className="size-3.5 animate-spin" /> : savedPath ? <Check className="size-3.5" /> : <Download className="size-3.5" />}
      {saving ? '正在保存…' : savedPath ? '已保存到我的文件' : '保存到我的文件'}
    </button>
    {savedPath && <p role="status" className="mt-1 break-all text-muted-foreground">{savedPath}</p>}
    {error && <p role="alert" className="mt-1 text-status-failed">{error}</p>}
  </div>;
}
