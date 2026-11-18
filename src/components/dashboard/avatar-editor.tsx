'use client';

import { useEffect, useState } from 'react';
import { Shuffle, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Avatar, AvatarImage } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { extractErrorDetail } from '@/lib/api-base';
import { avatarAssetUrl, avatarEndpoint, AVATAR_IMAGE_TYPES, AVATAR_PRESETS, AVATAR_SERIES, MAX_AVATAR_BYTES, type AvatarKind } from '@/lib/avatars';
import { AccountAvatar, refreshAccountAvatar } from './account-avatar';

export function AvatarEditor({ kind, name, onClose }: {
  kind: AvatarKind;
  name: string;
  onClose: () => void;
}) {
  const [series, setSeries] = useState<string>(kind === 'agent' ? 'pixelbot' : 'open-peeps');
  const [preset, setPreset] = useState<string | null>(null);
  const [upload, setUpload] = useState<{ file: File; preview: string } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const choices = AVATAR_PRESETS.filter(item => item.series === series);
  const preview = upload?.preview ?? (preset ? avatarAssetUrl(preset) : null);

  useEffect(() => () => { if (upload) URL.revokeObjectURL(upload.preview); }, [upload]);

  function choosePreset(id: string) {
    setPreset(id);
    setUpload(null);
    setError('');
  }

  async function save() {
    if ((!upload && !preset) || pending) return;
    setPending(true);
    setError('');
    try {
      const response = await fetch(avatarEndpoint(kind, name), {
        method: 'PUT',
        headers: { 'Content-Type': upload?.file.type ?? 'application/json' },
        body: upload?.file ?? JSON.stringify({ preset }),
      });
      if (!response.ok) throw new Error(await extractErrorDetail(response, '头像保存失败'));
      refreshAccountAvatar(kind, name);
      toast.success('头像已更新');
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : '头像保存失败');
    } finally {
      setPending(false);
    }
  }

  return (
    <Dialog open onOpenChange={open => { if (!open && !pending) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>更换头像</DialogTitle>
          <DialogDescription>{name}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-3">
          {preview ? <Avatar className="size-16 rounded-xl"><AvatarImage src={preview} alt="头像预览" className="object-cover" /></Avatar>
            : <AccountAvatar kind={kind} name={name} className="size-16 rounded-xl" />}
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={() => {
            const available = choices.filter(item => item.id !== preset);
            choosePreset(available[Math.floor(Math.random() * available.length)].id);
          }}><Shuffle aria-hidden="true" />随机换一个</Button>
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-xs hover:bg-muted focus-within:ring-2 focus-within:ring-ring">
            <Upload className="size-4" aria-hidden="true" />上传图片
            <input type="file" aria-label="上传图片" className="sr-only" accept={AVATAR_IMAGE_TYPES.join(',')} disabled={pending}
              onChange={event => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = '';
                if (!file) return;
                if (file.size > MAX_AVATAR_BYTES || !AVATAR_IMAGE_TYPES.includes(file.type)) {
                  setError('请选择 2 MB 以内的 PNG、JPEG、WebP 或 GIF 图片');
                  return;
                }
                setUpload({ file, preview: URL.createObjectURL(file) });
                setPreset(null);
                setError('');
              }} />
          </label>
        </div>
        <div role="group" aria-label="头像系列" className="flex flex-wrap gap-1 rounded-lg bg-muted p-1">
          {AVATAR_SERIES.map(item => (
            <Button key={item.id} size="sm" variant={series === item.id ? 'outline' : 'ghost'}
              aria-pressed={series === item.id} disabled={pending} onClick={() => setSeries(item.id)}>{item.label}</Button>
          ))}
        </div>
        <div role="group" aria-label="预设头像" className="grid grid-cols-3 gap-2 sm:grid-cols-6">
          {choices.map(item => (
            <button key={item.id} type="button" aria-label={item.label} aria-pressed={preset === item.id} disabled={pending}
              className={`rounded-lg border p-1 transition-colors hover:bg-muted ${preset === item.id ? 'border-emerald-600 bg-emerald-500/10 ring-1 ring-emerald-600' : 'border-border'}`}
              onClick={() => choosePreset(item.id)}>
              <Avatar className="aspect-square h-auto w-full rounded-md"><AvatarImage src={avatarAssetUrl(item.id)} alt="" /></Avatar>
            </button>
          ))}
        </div>
        {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
        <DialogFooter>
          <Button type="button" variant="outline" disabled={pending} onClick={onClose}>取消</Button>
          <Button type="button" disabled={pending || (!upload && !preset)} onClick={() => void save()}>{pending ? '保存中…' : '保存头像'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
