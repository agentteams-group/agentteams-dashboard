'use client';

import { useState, useMemo, useCallback, useRef } from 'react';
import {
  HardDrive,
  Folder,
  File,
  Download,
  Trash2,
  Upload,
  ChevronRight,
  Loader2,
} from 'lucide-react';
import { SectionHeader } from '@/components/dashboard/section-header';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import {
  useBuckets,
  useObjects,
  useDeleteObject,
  useDownloadObjectUrl,
  useUploadObject,
} from '@/hooks/use-hiclaw-storage';

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function basename(key: string): string {
  return key.split('/').pop() || key;
}

export function StorageSection() {
  const { data: buckets, isLoading: bucketsLoading } = useBuckets();
  const [bucket, setBucket] = useState<string>('');
  const [prefix, setPrefix] = useState('');
  const { data: objects, isLoading: objectsLoading } = useObjects(bucket || null, prefix);
  const deleteObject = useDeleteObject();
  const downloadObject = useDownloadObjectUrl();
  const uploadObject = useUploadObject();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  const selectedBucketName = useMemo(() => bucket, [bucket]);

  const breadcrumbs = useMemo(() => {
    const parts = prefix ? prefix.replace(/\/$/, '').split('/') : [];
    return ['根目录', ...parts];
  }, [prefix]);

  const navigateToIndex = useCallback(
    (index: number) => {
      if (index === 0) {
        setPrefix('');
        return;
      }
      const parts = prefix.replace(/\/$/, '').split('/');
      setPrefix(parts.slice(0, index).join('/') + '/');
    },
    [prefix]
  );

  const handleObjectClick = useCallback(
    (obj: { key: string; isPrefix?: boolean }) => {
      if (obj.isPrefix) {
        setPrefix(obj.key);
      }
    },
    []
  );

  const handleDownload = useCallback(
    async (key: string) => {
      if (!selectedBucketName) return;
      try {
        const url = await downloadObject.mutateAsync({ bucket: selectedBucketName, key });
        window.open(url, '_blank');
      } catch {
        toast.error('生成下载链接失败');
      }
    },
    [downloadObject, selectedBucketName]
  );

  const handleDelete = useCallback(
    async (key: string) => {
      if (!selectedBucketName) return;
      if (!confirm(`确认删除 ${basename(key)}?`)) return;
      try {
        await deleteObject.mutateAsync({ bucket: selectedBucketName, key });
        toast.success('已删除');
      } catch {
        toast.error('删除失败');
      }
    },
    [deleteObject, selectedBucketName]
  );

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file || !selectedBucketName) return;
      setUploading(true);
      try {
        const key = prefix ? `${prefix}${file.name}` : file.name;
        await uploadObject.mutateAsync({ bucket: selectedBucketName, key, file });
        toast.success('上传成功');
      } catch {
        toast.error('上传失败');
      } finally {
        setUploading(false);
        if (fileInputRef.current) fileInputRef.current.value = '';
      }
    },
    [uploadObject, selectedBucketName, prefix]
  );

  return (
    <div className="space-y-4">
      <SectionHeader
        title="对象存储"
        description="浏览 MinIO 存储桶与对象，支持上传、下载、删除"
      />

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Select value={bucket} onValueChange={setBucket}>
          <SelectTrigger className="w-64">
            <SelectValue placeholder={bucketsLoading ? '加载中...' : '选择存储桶'} />
          </SelectTrigger>
          <SelectContent>
            {buckets?.map((b) => (
              <SelectItem key={b.name} value={b.name}>
                <div className="flex items-center gap-2">
                  <HardDrive className="w-4 h-4" />
                  {b.name}
                </div>
              </SelectItem>
            ))}
          </SelectContent>
        </Select>

        {bucket && (
          <>
            <input
              type="file"
              ref={fileInputRef}
              className="hidden"
              onChange={handleFileSelect}
            />
            <Button
              variant="outline"
              size="sm"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
              ) : (
                <Upload className="w-4 h-4 mr-2" />
              )}
              上传文件
            </Button>
          </>
        )}
      </div>

      {bucket && (
        <div className="flex items-center gap-1 text-sm text-muted-foreground">
          {breadcrumbs.map((part, idx) => (
            <span key={idx} className="flex items-center">
              {idx > 0 && <ChevronRight className="w-3 h-3 mx-1" />}
              <button
                className="hover:text-foreground disabled:text-foreground"
                onClick={() => navigateToIndex(idx)}
                disabled={idx === breadcrumbs.length - 1}
              >
                {part}
              </button>
            </span>
          ))}
        </div>
      )}

      <ScrollArea className="h-[500px] rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>对象</TableHead>
              <TableHead>大小</TableHead>
              <TableHead>最后修改</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!bucket && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  请先选择一个存储桶
                </TableCell>
              </TableRow>
            )}
            {bucket && objectsLoading && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  加载中...
                </TableCell>
              </TableRow>
            )}
            {bucket && !objectsLoading && objects?.length === 0 && (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  该前缀下暂无对象
                </TableCell>
              </TableRow>
            )}
            {objects?.map((obj) => (
              <TableRow key={obj.key}>
                <TableCell className="font-mono text-xs">
                  <button
                    className="flex items-center gap-2 hover:text-orange-600"
                    onClick={() => handleObjectClick(obj)}
                    disabled={!obj.isPrefix}
                  >
                    {obj.isPrefix ? (
                      <Folder className="w-4 h-4 text-amber-500" />
                    ) : (
                      <File className="w-4 h-4 text-blue-500" />
                    )}
                    {basename(obj.key)}
                  </button>
                </TableCell>
                <TableCell>{obj.isPrefix ? '-' : formatBytes(obj.size)}</TableCell>
                <TableCell>
                  {obj.lastModified
                    ? new Date(obj.lastModified).toLocaleString('zh-CN')
                    : '-'}
                </TableCell>
                <TableCell className="text-right">
                  {!obj.isPrefix && (
                    <>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDownload(obj.key)}
                        disabled={downloadObject.isPending}
                      >
                        <Download className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleDelete(obj.key)}
                        disabled={deleteObject.isPending}
                      >
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </ScrollArea>
    </div>
  );
}
