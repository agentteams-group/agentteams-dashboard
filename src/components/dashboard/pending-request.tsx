'use client';

import { useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { useMatrixStore } from '@/lib/matrix-store';
import { matrixApi } from '@/lib/matrix-api';
import { type HitlConfirmation, resolveEventContent } from '@/lib/hitl-inbox';
import { normalizeToBlocks } from '@/lib/a2ui/normalize';
import { isInterventionConfirmation, type RuntimeConfirmationBlock } from '@/lib/a2ui/protocol';
import { useMatrixSendMessage } from '@/hooks/use-matrix';
import { ConfirmationCard, toConfirmationCardPayload } from './sections/chat/confirmation-card';
import { InterventionCard } from './sections/chat/intervention-card';
import { buildAnswerContent, buildConfirmationReply, type ConfirmationAnswerField } from './sections/chat/confirmation-reply';

/** Load the original request so choices, permissions and expiry match the room. */
export function PendingRequest({ item, children }: { item: HitlConfirmation; children: ReactNode; onNavigate?: () => void }) {
  const [expanded, setExpanded] = useState(false);
  return <div className="space-y-2">
    {children}
    <Button variant="ghost" size="sm" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}>
      {expanded ? '收起' : item.question ? '答复' : '处理审批'}
    </Button>
    {expanded && <PendingRequestCard item={item} />}
  </div>;
}

function PendingRequestCard({ item }: { item: HitlConfirmation }) {
  const { homeserver, accessToken, userId } = useMatrixStore();
  const send = useMatrixSendMessage();
  const request = useQuery({
    queryKey: ['pending-request', item.roomId, item.eventId],
    enabled: !!homeserver && !!accessToken,
    queryFn: async () => matrixApi.getRoomEvent(homeserver!, accessToken!, item.roomId, item.eventId),
  });
  const content = request.data ? resolveEventContent(request.data) : null;
  const block = content ? normalizeToBlocks({
    body: typeof content.body === 'string' ? content.body : '',
    formattedBody: typeof content.formatted_body === 'string' ? content.formatted_body : undefined,
    content, isStreaming: false, isMine: item.sender === userId,
  }).find(block => block.type === 'confirmation') : undefined;

  const reply = async (text: string, answer?: ConfirmationAnswerField): Promise<boolean> => {
    const message = buildConfirmationReply(text, item.sender, [item.sender]);
    try {
      await send.mutateAsync({
        roomId: item.roomId, body: message.content,
        mentions: { user_ids: [item.sender] },
        relatesTo: { rel_type: 'm.reference', event_id: item.eventId },
        extra: buildAnswerContent(answer),
      });
      return true;
    } catch {
      return false; // Existing cards retain the request and offer retry.
    }
  };

  return request.isPending ? <p role="status" className="text-xs text-muted-foreground">加载请求…</p>
      : request.isError || !block ? <div role="alert" className="text-xs">请求暂时无法加载，请重试或打开原消息。<Button variant="ghost" size="sm" onClick={() => request.refetch()}>重试</Button></div>
      : isInterventionConfirmation(block)
        ? <InterventionCard sourceRoomId={item.roomId} payload={(block as RuntimeConfirmationBlock).payload} onAnswer={reply} />
        : <ConfirmationCard payload={{ ...toConfirmationCardPayload(block.payload ?? {}), resolutionKey: item.id }} onApprove={reply} onReject={reply} onCancel={reply} />;
}
