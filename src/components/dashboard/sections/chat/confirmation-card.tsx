'use client';

import { useState } from 'react';
import { Shield, Check, X, ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';

export interface ConfirmationCardPayload {
  toolName: string;
  triggeredBy?: string;
  parameters?: string;
  approveReply: string;
  rejectReply: string;
}

interface ConfirmationCardProps {
  payload: ConfirmationCardPayload;
  onApprove: (_reply: string) => void;
  onReject: (_reply: string) => void;
}

export function ConfirmationCard({ payload, onApprove, onReject }: ConfirmationCardProps) {
  const [submitted, setSubmitted] = useState<'approve' | 'reject' | null>(null);
  const [expanded, setExpanded] = useState(true);

  const handleApprove = () => {
    setSubmitted('approve');
    onApprove(payload.approveReply);
  };

  const handleReject = () => {
    setSubmitted('reject');
    onReject(payload.rejectReply);
  };

  if (submitted) {
    return (
      <div className={`my-2 rounded-lg border border-l-4 px-3 py-2 text-xs ${
        submitted === 'approve'
          ? 'border-l-emerald-500 bg-emerald-500/5 border-emerald-500/30'
          : 'border-l-red-500 bg-red-500/5 border-red-500/30'
      }`}>
        <span className={submitted === 'approve' ? 'text-emerald-600' : 'text-red-600'}>
          {submitted === 'approve' ? '已批准' : '已拒绝'} - {payload.toolName}
        </span>
      </div>
    );
  }

  return (
    <div className="my-2 rounded-lg border border-amber-500/30 border-l-4 border-l-amber-500 bg-amber-500/5 overflow-hidden">
      <button
        type="button"
        className="w-full flex items-center justify-between px-3 py-2 text-xs font-medium text-amber-600 hover:bg-amber-500/10 transition-colors"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="flex items-center gap-2">
          <Shield className="w-3.5 h-3.5" />
          工具审批 - {payload.toolName}
        </span>
        {expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
      </button>

      {expanded && (
        <div className="px-3 pb-3 space-y-2">
          {payload.triggeredBy && (
            <div className="text-[11px] text-muted-foreground">
              <span className="font-medium text-foreground/70">触发来源：</span>
              {payload.triggeredBy}
            </div>
          )}
          {payload.parameters && (
            <pre className="text-[11px] bg-muted/50 rounded p-2 overflow-x-auto text-muted-foreground max-h-32 overflow-y-auto whitespace-pre-wrap">
              {payload.parameters}
            </pre>
          )}
          <div className="flex items-center gap-2 pt-1">
            <Button
              size="sm"
              className="h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700"
              onClick={handleApprove}
            >
              <Check className="w-3 h-3 mr-1" />
              批准
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-7 px-3 text-xs border-red-300 text-red-600 hover:bg-red-50"
              onClick={handleReject}
            >
              <X className="w-3 h-3 mr-1" />
              拒绝
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
