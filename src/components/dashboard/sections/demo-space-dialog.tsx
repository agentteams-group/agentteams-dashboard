'use client';

import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { WorkflowCard } from './chat/views/workflow-card';
import { ReviewReportCard } from './chat/review-report-card';
import { InterventionCard } from './chat/intervention-card';
import {
  DEMO_WORKFLOW_PAYLOAD,
  DEMO_REVIEW_PAYLOAD,
  DEMO_INTERVENTION_PAYLOAD,
} from '@/lib/demo-space-fixtures';
import type { AnswerSendResult } from './chat/confirmation-reply';
import { Bot, CheckCircle2, Sparkles, UserCheck } from 'lucide-react';

interface DemoSpaceDialogProps {
  open: boolean;
  onOpenChange: (_open: boolean) => void;
  onCompleteAllSteps?: () => void;
}

export function DemoSpaceDialog({
  open,
  onOpenChange,
  onCompleteAllSteps,
}: DemoSpaceDialogProps) {
  const [answeredText, setAnsweredText] = useState<string | null>(null);

  const handleInterventionAnswer = (text: string): AnswerSendResult => {
    setAnsweredText(text);
    return true;
  };

  const handleFinish = () => {
    onCompleteAllSteps?.();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader className="border-b border-border/60 pb-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-emerald-500" aria-hidden />
              <div>
                <DialogTitle className="text-base font-semibold">示例空间 · 离线全闭环演练</DialogTitle>
                <DialogDescription className="text-xs text-muted-foreground mt-0.5">
                  房间 <span className="font-mono text-foreground font-medium">!demo_space:local</span> · 包含接力卡、审查报告卡与人工干预答复
                </DialogDescription>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <Badge variant="outline" className="text-xs border-emerald-500/40 text-emerald-600 bg-emerald-500/10">
                免后端运行
              </Badge>
              <Badge variant="outline" className="text-xs">
                已 PII 脱敏
              </Badge>
            </div>
          </div>
        </DialogHeader>

        <div className="space-y-4 py-2 text-sm">
          {/* Step 1: Worker 收到任务发出的第一条规划消息 */}
          <div className="flex items-start gap-3">
            <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
              <Bot className="h-4 w-4 text-primary" />
            </div>
            <div className="space-y-1.5 max-w-[90%]">
              <div className="flex items-center gap-2">
                <span className="font-medium text-xs">architect_agent</span>
                <span className="text-xs text-muted-foreground">10:00:00</span>
              </div>
              <div className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed">
                收到用户需求：启动「订单支付回路改造」。已自动分派 3 个专业 Agent（架构、编码、审查）协同实施。
              </div>
            </div>
          </div>

          {/* Step 2: 接力卡展示 */}
          <div className="pl-11">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">① 任务流转（接力卡 Workflow Card）</p>
            <WorkflowCard payload={DEMO_WORKFLOW_PAYLOAD} />
          </div>

          {/* Step 3: 审查报告卡展示 */}
          <div className="pl-11">
            <p className="text-xs font-semibold text-muted-foreground mb-1.5">② 质量与安全门禁（审查报告卡 Review Report）</p>
            <ReviewReportCard payload={DEMO_REVIEW_PAYLOAD} />
          </div>

          {/* Step 4: 人工干预确认卡 */}
          <div className="pl-11 space-y-2">
            <p className="text-xs font-semibold text-muted-foreground">③ 人机回路（人工介入确认卡 HITL Intervention）</p>
            <InterventionCard
              payload={DEMO_INTERVENTION_PAYLOAD}
              onAnswer={handleInterventionAnswer}
            />
            {answeredText && (
              <div className="flex items-start gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 p-2 text-xs text-emerald-800 dark:text-emerald-300">
                <UserCheck className="h-4 w-4 shrink-0 text-emerald-600 mt-0.5" />
                <div>
                  <span className="font-medium">你已答复：</span>
                  <span>{answeredText}</span>
                  <span className="ml-2 text-muted-foreground">（已自动回写至审计日志与消息流）</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="flex items-center justify-between border-t border-border/60 pt-3">
          <span className="text-xs text-muted-foreground">已跑完示例空间完整闭环</span>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenChange(false)}>
              关闭
            </Button>
            <Button size="sm" className="gap-1.5" onClick={handleFinish}>
              <CheckCircle2 className="h-4 w-4" />
              完成演练并打勾所有步骤
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
