'use client';

import { useAgentTeamsStore } from '@/lib/agentteams-store';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

export function ChatInputSettings() {
  const action = useAgentTeamsStore(state => state.replyEnterAction);
  const setAction = useAgentTeamsStore(state => state.setReplyEnterAction);

  return (
    <section className="space-y-3 rounded-lg border p-4" aria-label="聊天输入设置">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Label htmlFor="reply-enter-action">回复中按 Enter</Label>
        <Select value={action} onValueChange={value => setAction(value === 'queue' ? 'queue' : 'send')}>
          <SelectTrigger id="reply-enter-action" className="w-36"><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="send">立即发送</SelectItem>
            <SelectItem value="queue">排队</SelectItem>
          </SelectContent>
        </Select>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">仅在 Agent 回复中生效；点击“发送”始终立即发送。Shift+Enter 换行。</p>
    </section>
  );
}
