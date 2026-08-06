'use client';

import { useState } from 'react';
import { Search, Wifi, X } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { useMcpServers } from '@/hooks/use-agentteams-mcps';
import type { McpServerConfig } from '@/lib/agentteams-api';

export interface SelectedMcpServer {
  name: string;
  url: string;
  transport: string;
}

interface McpSelectorProps {
  value: SelectedMcpServer[];
  onChange: (_mcps: SelectedMcpServer[]) => void;
}

export function McpSelector({ value, onChange }: McpSelectorProps) {
  const { data: servers = [] } = useMcpServers();
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<SelectedMcpServer[]>([]);

  const selectedNames = new Set(value.map((s) => s.name));

  const filtered = servers.filter((s) => {
    if (selectedNames.has(s.name)) return false;
    const q = search.toLowerCase();
    if (!q) return true;
    return s.name.toLowerCase().includes(q) || s.url.toLowerCase().includes(q);
  });

  const handleOpen = (isOpen: boolean) => {
    if (isOpen) {
      setDraft([...value]);
      setSearch('');
    }
    setOpen(isOpen);
  };

  const handleToggle = (srv: McpServerConfig) => {
    const exists = draft.find((d) => d.name === srv.name);
    if (exists) {
      setDraft(draft.filter((d) => d.name !== srv.name));
    } else {
      setDraft([...draft, { name: srv.name, url: srv.url, transport: srv.transport }]);
    }
  };

  const handleConfirm = () => {
    onChange(draft);
    setOpen(false);
  };

  const handleRemove = (name: string) => {
    onChange(value.filter((s) => s.name !== name));
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {value.length === 0 && (
          <span className="text-sm text-muted-foreground">暂未选择 MCP 服务器</span>
        )}
        {value.map((srv) => (
          <Badge key={srv.name} variant="secondary" className="gap-1 pr-1">
            <Wifi className="w-3 h-3" />
            {srv.name}
            <button
              type="button"
              onClick={() => handleRemove(srv.name)}
              className="ml-1 rounded-full hover:bg-muted p-0.5"
            >
              <X className="w-3 h-3" />
            </button>
          </Badge>
        ))}
      </div>
      <Dialog open={open} onOpenChange={handleOpen}>
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="w-full justify-start" type="button">
            <Search className="w-3.5 h-3.5 mr-2 text-muted-foreground" />
            {value.length > 0 ? `${value.length} 个 MCP 服务器已选择...` : '选择 MCP 服务器...'}
          </Button>
        </DialogTrigger>
        <DialogContent className="sm:max-w-md max-w-[95vw] overflow-hidden">
          <DialogHeader>
            <DialogTitle>选择 MCP 服务器</DialogTitle>
          </DialogHeader>

          <div className="space-y-3">
            <Input
              placeholder="搜索 MCP 服务器..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="min-w-0"
            />

            <div className="max-h-[240px] overflow-y-auto space-y-1">
              {filtered.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-6">
                  {search ? '没有匹配的 MCP 服务器' : '暂无可用 MCP 服务器，请先在技能中心配置'}
                </p>
              )}
              {filtered.map((srv) => {
                const isSelected = draft.some((d) => d.name === srv.name);
                return (
                  <button
                    key={srv.name}
                    type="button"
                    onClick={() => handleToggle(srv)}
                    className={`w-full flex items-center gap-3 p-2.5 rounded-lg text-left transition-colors ${
                      isSelected ? 'bg-primary/5 border border-primary/20' : 'hover:bg-accent'
                    }`}
                  >
                    <div className="w-8 h-8 rounded-lg bg-emerald-500/10 flex items-center justify-center shrink-0">
                      <Wifi className="w-4 h-4 text-emerald-500" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="font-medium text-sm truncate">{srv.name}</span>
                        <Badge variant="outline" className="text-[10px] shrink-0">{srv.transport}</Badge>
                      </div>
                      <p className="text-xs text-muted-foreground truncate" title={srv.url}>
                        {srv.url}
                      </p>
                    </div>
                    {isSelected && (
                      <div className="w-5 h-5 rounded-full bg-primary flex items-center justify-center shrink-0">
                        <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
                          <path d="M2.5 6L5 8.5L9.5 3.5" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                        </svg>
                      </div>
                    )}
                  </button>
                );
              })}
            </div>

            {draft.length > 0 && (
              <div className="border-t pt-2">
                <span className="text-xs text-muted-foreground">已选择 ({draft.length}):</span>
                <div className="flex flex-wrap gap-1 mt-1">
                  {draft.map((srv) => (
                    <Badge key={srv.name} variant="secondary" className="text-[10px]">{srv.name}</Badge>
                  ))}
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>取消</Button>
            <Button onClick={handleConfirm}>确定 ({draft.length} 个)</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
