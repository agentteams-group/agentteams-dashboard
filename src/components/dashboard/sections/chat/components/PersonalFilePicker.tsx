'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { File as FileIcon, Folder, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { useMatrixStore } from '@/lib/matrix-store';
import { agentteamsApi } from '@/lib/agentteams-api';
import { humanFilesApi, entryDisplayName, entryRelPath, joinHumanDir, parentHumanDir, type HumanFileEntry } from '@/lib/human-files-api';

export function PersonalFilePicker({ onSend, onDone }: { onSend: (_file: File) => void | Promise<void>; onDone: () => void }) {
  const sessionUser = useAgentTeamsStore(state => state.sessionUser);
  const userLevel = useAgentTeamsStore(state => state.userLevel);
  const userId = useMatrixStore(state => state.userId);
  const [dir, setDir] = useState('');
  const [selected, setSelected] = useState<HumanFileEntry | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const identity = useQuery({
    queryKey: ['chat-personal-human', sessionUser, userId, userLevel],
    enabled: !!sessionUser && !!userId,
    queryFn: async () => {
      if (userLevel < 3) return sessionUser!.startsWith('@') ? sessionUser!.slice(1).split(':')[0] : sessionUser!;
      const human = (await agentteamsApi.listHumans()).find(human => human.matrixUserID === userId);
      if (!human) throw new Error('当前账号的个人文件区尚未就绪');
      return human.name;
    },
    retry: false,
  });
  const listing = useQuery({
    queryKey: ['human-files', identity.data, dir],
    queryFn: () => humanFilesApi.listDirectory(identity.data!, dir),
    enabled: !!identity.data,
    retry: false,
  });
  const changeDir = (path: string) => { setDir(path); setSelected(null); setError(''); };
  const send = async () => {
    if (!selected || !identity.data || sending) return;
    setSending(true);
    setError('');
    try {
      const path = selected.path ?? joinHumanDir(dir, selected.name);
      const blob = await humanFilesApi.download(identity.data, path, { size: selected.size });
      await onSend(new File([blob], entryDisplayName(selected), { type: blob.type || 'application/octet-stream' }));
      onDone();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '文件发送失败，请重试');
    } finally {
      setSending(false);
    }
  };
  const loadError = identity.error || listing.error;
  return <div className="space-y-3">
    <p className="text-xs text-muted-foreground">选中的文件将作为附件发送到当前会话，接收方可以下载。</p>
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      {dir && <Button variant="ghost" size="sm" disabled={sending} onClick={() => changeDir(parentHumanDir(dir))}>返回上级</Button>}
      <span className="truncate">我的文件 / {dir}</span>
    </div>
    {loadError ? <div role="alert" className="text-sm text-status-failed">{loadError.message}<Button variant="ghost" size="sm" onClick={() => { if (identity.error) void identity.refetch(); else void listing.refetch(); }}>重试</Button></div>
      : !sessionUser || !userId ? <p role="status">请先登录后选择个人文件</p>
      : identity.isLoading || listing.isLoading ? <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="size-4 animate-spin" />正在加载我的文件…</p>
      : <ul className="max-h-72 divide-y divide-border/40 overflow-y-auto rounded-md border border-border/60">
        {listing.data?.entries.length === 0 && <li className="p-6 text-center text-sm text-muted-foreground">此目录暂无文件</li>}
        {listing.data?.entries.map(entry => <li key={entryRelPath(entry)}>
          {entry.type === 'directory' ? <button type="button" disabled={sending} className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-muted" onClick={() => changeDir(entry.path ?? joinHumanDir(dir, entry.name))}><Folder className="size-4" />{entryDisplayName(entry)}</button>
            : <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm hover:bg-muted"><input type="radio" name="personal-file" aria-label={entryDisplayName(entry)} disabled={sending} checked={selected === entry} onChange={() => setSelected(entry)} /><FileIcon className="size-4 shrink-0" /><span className="truncate">{entryDisplayName(entry)}</span></label>}
        </li>)}
      </ul>}
    {error && <p role="alert" className="text-sm text-status-failed">{error}</p>}
    <div className="flex justify-end"><Button disabled={!selected || sending} onClick={() => void send()}>{sending ? '正在发送…' : '发送到当前会话'}</Button></div>
  </div>;
}
