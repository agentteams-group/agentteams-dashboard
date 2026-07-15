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
  Plus,
  X,
  Search,
  BarChart3,
  CheckSquare,
  Square,
} from 'lucide-react';
import { SectionHeader } from '@/components/dashboard/section-header';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
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
  useCreateBucket,
  useDeleteBucket,
  useBucketStats,
  useBulkDeleteObjects,
} from '@/hooks/use-agentteams-storage';

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
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(new Set());
  // Reset selections when bucket changes
  const handleBucketChange = useCallback((b: string) => {
    setBucket(b);
    setPrefix('');
    setSearchQuery('');
    setSelectedKeys(new Set());
  }, []);
  const { data: objects, isLoading: objectsLoading } = useObjects(bucket || null, prefix);
  const deleteObject = useDeleteObject();
  const downloadObject = useDownloadObjectUrl();
  const uploadObject = useUploadObject();
  const createBucket = useCreateBucket();
  const deleteBucket = useDeleteBucket();
  const { data: bucketStats } = useBucketStats(bucket || null);
  const bulkDelete = useBulkDeleteObjects();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [showNewBucket, setShowNewBucket] = useState(false);
  const [newBucketName, setNewBucketName] = useState('');

  const selectedBucketName = useMemo(() => bucket, [bucket]);

  // Filter objects by search query
  const filteredObjects = useMemo(() => {
    if (!objects) return [];
    if (!searchQuery.trim()) return objects;
    const q = searchQuery.toLowerCase();
    return objects.filter((obj) => basename(obj.key).toLowerCase().includes(q));
  }, [objects, searchQuery]);

  const toggleSelect = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const toggleSelectAll = useCallback(() => {
    if (!filteredObjects) return;
    const fileKeys = filteredObjects.filter((o) => !o.isPrefix).map((o) => o.key);
    if (fileKeys.every((k) => selectedKeys.has(k))) {
      setSelectedKeys(new Set());
    } else {
      setSelectedKeys(new Set(fileKeys));
    }
  }, [filteredObjects, selectedKeys]);

  const handleBulkDelete = useCallback(async () => {
    if (!selectedBucketName || selectedKeys.size === 0) return;
    if (!confirm(`确认删除 ${selectedKeys.size} 个对象？`)) return;
    try {
      const result = await bulkDelete.mutateAsync({
        bucket: selectedBucketName,
        keys: Array.from(selectedKeys),
      });
      toast.success(`已删除 ${result.deleted} 个对象`);
      setSelectedKeys(new Set());
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '批量删除失败');
    }
  }, [selectedBucketName, selectedKeys, bulkDelete]);

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

  const handleCreateBucket = useCallback(async () => {
    const name = newBucketName.trim().toLowerCase();
    if (!name) return;
    try {
      await createBucket.mutateAsync(name);
      toast.success(`桶 "${name}" 创建成功`);
      setNewBucketName('');
      setShowNewBucket(false);
      setBucket(name);
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '创建失败');
    }
  }, [newBucketName, createBucket]);

  const handleDeleteBucket = useCallback(async () => {
    if (!selectedBucketName) return;
    if (!confirm(`确认删除桶 "${selectedBucketName}"？桶内所有对象将被永久删除！`)) return;
    try {
      await deleteBucket.mutateAsync(selectedBucketName);
      toast.success(`桶 "${selectedBucketName}" 已删除`);
      setBucket('');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : '删除失败');
    }
  }, [selectedBucketName, deleteBucket]);

  return (
    <div className="space-y-4">
      <SectionHeader
        title="对象存储"
        description="浏览 MinIO 存储桶与对象，支持上传、下载、删除"
      />

      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        <Select value={bucket} onValueChange={handleBucketChange}>
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

        <Button
          variant="outline"
          size="sm"
          onClick={() => setShowNewBucket((v) => !v)}
        >
          <Plus className="w-3.5 h-3.5 mr-1" />
          新建桶
        </Button>

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
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive"
              onClick={handleDeleteBucket}
              disabled={deleteBucket.isPending}
            >
              <Trash2 className="w-3.5 h-3.5 mr-1" />
              删除桶
            </Button>
          </>
        )}
      </div>

      {/* Bucket stats */}
      {bucket && bucketStats && (
        <div className="flex items-center gap-4 p-3 rounded-lg bg-muted/30 border border-border/50">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-muted-foreground" />
            <span className="text-xs text-muted-foreground">桶统计</span>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">对象:</span>
            <span className="font-mono font-medium">{bucketStats.objectCount}</span>
          </div>
          <div className="flex items-center gap-1 text-xs">
            <span className="text-muted-foreground">总大小:</span>
            <span className="font-mono font-medium">{formatBytes(bucketStats.totalSize)}</span>
          </div>
        </div>
      )}

      {showNewBucket && (
        <div className="flex items-center gap-2 max-w-md">
          <Input
            value={newBucketName}
            onChange={(e) => setNewBucketName(e.target.value)}
            placeholder="桶名称 (小写字母、数字、连字符)"
            className="h-8 text-sm"
            onKeyDown={(e) => e.key === 'Enter' && handleCreateBucket()}
          />
          <Button size="sm" onClick={handleCreateBucket} disabled={!newBucketName.trim() || createBucket.isPending}>
            {createBucket.isPending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : '创建'}
          </Button>
          <Button variant="ghost" size="sm" onClick={() => { setShowNewBucket(false); setNewBucketName(''); }}>
            <X className="w-3.5 h-3.5" />
          </Button>
        </div>
      )}

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

      {/* Search + Bulk actions */}
      {bucket && (
        <div className="flex items-center gap-2">
          <div className="relative flex-1 max-w-xs">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索对象..."
              className="h-8 pl-8 text-xs"
            />
          </div>
          {selectedKeys.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              className="h-8 text-xs"
              onClick={handleBulkDelete}
              disabled={bulkDelete.isPending}
            >
              {bulkDelete.isPending ? (
                <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />
              ) : (
                <Trash2 className="w-3.5 h-3.5 mr-1" />
              )}
              删除 {selectedKeys.size} 项
            </Button>
          )}
        </div>
      )}

      <ScrollArea className="h-[500px] rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8">
                {bucket && filteredObjects.some((o) => !o.isPrefix) && (
                  <button onClick={toggleSelectAll} className="shrink-0">
                    {filteredObjects.filter((o) => !o.isPrefix).every((o) => selectedKeys.has(o.key)) ? (
                      <CheckSquare className="w-4 h-4 text-primary" />
                    ) : (
                      <Square className="w-4 h-4 text-muted-foreground/50" />
                    )}
                  </button>
                )}
              </TableHead>
              <TableHead>对象</TableHead>
              <TableHead>大小</TableHead>
              <TableHead>最后修改</TableHead>
              <TableHead className="text-right">操作</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {!bucket && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  请先选择一个存储桶
                </TableCell>
              </TableRow>
            )}
            {bucket && objectsLoading && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  加载中...
                </TableCell>
              </TableRow>
            )}
            {bucket && !objectsLoading && filteredObjects?.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="text-center text-muted-foreground">
                  {searchQuery ? '没有匹配的对象' : '该前缀下暂无对象'}
                </TableCell>
              </TableRow>
            )}
            {filteredObjects?.map((obj) => (
              <TableRow key={obj.key} className={selectedKeys.has(obj.key) ? 'bg-accent/50' : ''}>
                <TableCell className="w-8">
                  {!obj.isPrefix && (
                    <button onClick={() => toggleSelect(obj.key)}>
                      {selectedKeys.has(obj.key) ? (
                        <CheckSquare className="w-4 h-4 text-primary" />
                      ) : (
                        <Square className="w-4 h-4 text-muted-foreground/50" />
                      )}
                    </button>
                  )}
                </TableCell>
                <TableCell className="font-mono text-xs">
                  <button
                    className="flex items-center gap-2 hover:text-primary"
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
