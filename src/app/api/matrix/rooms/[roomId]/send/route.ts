// PUT /api/matrix/rooms/[roomId]/send - Send message to room
import { NextRequest, NextResponse } from 'next/server';
import { getMatrixHomeserver, getAccessToken } from '../../../proxy-helper';
import { READ_AUDIENCE_KEY } from '@/lib/message-read-status';
import { CONTROL_KEY } from '@/lib/direct-execution';

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ roomId: string }> }
) {
  try {
    const { roomId } = await params;
    const homeserver = getMatrixHomeserver(request);
    const accessToken = getAccessToken(request);

    const body = await request.json();
    const { msgtype = 'm.text', body: messageBody, format, formatted_body: formattedBody, url: mediaUrl, info, 'm.mentions': mentions, 'm.relates_to': relatesTo, 'm.new_content': newContent, 'com.agentteams.long_message': longMessage, 'com.agentteams.file_refs': fileRefs, 'com.agentteams.artifact_comment': artifactComment } = body;

    if (!messageBody) {
      return NextResponse.json({ error: 'Missing message body' }, { status: 400 });
    }

    const control = body[CONTROL_KEY];
    if (control !== undefined && (!control || typeof control !== 'object'
      || !['stop', 'steer'].includes(control.action)
      || typeof control.run_id !== 'string' || !control.run_id
      || typeof control.agent_id !== 'string' || !control.agent_id)) {
      return NextResponse.json({ error: 'Invalid execution control' }, { status: 400 });
    }

    const txnId = `agentteams_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const encodedRoomId = encodeURIComponent(roomId);
    const targetUrl = `${homeserver}/_matrix/client/v3/rooms/${encodedRoomId}/send/m.room.message/${txnId}`;

    const messageContent: Record<string, unknown> = {
      msgtype,
      body: messageBody,
    };
    if (control) messageContent[CONTROL_KEY] = {
      action: control.action, run_id: control.run_id, agent_id: control.agent_id,
    };

    if (body.track_read_status === true && relatesTo?.rel_type !== 'm.replace') {
      // Capture membership before sending; historical messages never consult
      // today's room membership. Failure only omits this optional status.
      try {
        const response = await fetch(`${homeserver}/_matrix/client/v3/rooms/${encodedRoomId}/joined_members`, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(5000),
          cache: 'no-store',
        });
        if (response.ok) {
          const { joined } = await response.json();
          const agents = new Set(Array.isArray(body.agent_user_ids) ? body.agent_user_ids : []);
          const humans = new Set(Array.isArray(body.human_user_ids) ? body.human_user_ids : []);
          if (joined && typeof joined === 'object') {
            messageContent[READ_AUDIENCE_KEY] = {
              version: 1,
              members: Object.entries(joined).map(([userId, profile]) => ({
                user_id: userId,
                display_name: (profile as { display_name?: string }).display_name || userId.split(':')[0].slice(1),
                kind: agents.has(userId) ? 'agent' : humans.has(userId) ? 'human' : 'member',
              })),
            };
          }
        }
      } catch {
        console.warn('Could not capture the message read audience');
      }
    }

    if (format && formattedBody) {
      messageContent.format = format;
      messageContent.formatted_body = formattedBody;
    }
    if (mediaUrl) {
      messageContent.url = mediaUrl;
    }
    if (info) {
      messageContent.info = info;
    }
    if (mentions) {
      messageContent['m.mentions'] = mentions;
    }
    // Thread replies (m.thread), inline replies (m.in_reply_to) and edits
    // (m.replace) all travel via m.relates_to; m.new_content carries the
    // replacement body for edits.
    if (relatesTo) {
      messageContent['m.relates_to'] = relatesTo;
    }
    if (newContent) {
      messageContent['m.new_content'] = newContent;
    }
    // Long-message fallback metadata (upstream F7): full text uploaded as an
    // attachment when a reply exceeds the 64KB threshold.
    if (longMessage) {
      messageContent['com.agentteams.long_message'] = longMessage;
    }
    // Chat file references (#87): workspace files attached to the outbound
    // message so the agent run can access them in context.
    if (fileRefs) {
      messageContent['com.agentteams.file_refs'] = fileRefs;
    }
    // 工件位置级评论（F6.2）：锚点元数据随消息携带（Stateless 安全），
    // 消息正文同时进房间时间线（「成果沉淀对话流」）。
    if (artifactComment && typeof artifactComment === 'object') {
      messageContent['com.agentteams.artifact_comment'] = artifactComment;
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);

    try {
      const res = await fetch(targetUrl, {
        method: 'PUT',
        signal: controller.signal,
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(messageContent),
      });

      const resultData = await res.arrayBuffer();
      const responseHeaders = new Headers();
      const resCT = res.headers.get('content-type');
      if (resCT) responseHeaders.set('content-type', resCT);

      return new NextResponse(resultData, {
        status: res.status,
        headers: responseHeaders,
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error';
    return NextResponse.json({ error: message }, { status: 502 });
  }
}
