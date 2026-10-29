import { describe, expect, it, vi } from 'vitest';

vi.mock('./matrix-write', () => ({
  matrixProxyFetch: vi.fn(async () => new Response(null, { status: 200 })),
}));

import { matrixProxyFetch } from './matrix-write';
import {
  COMMENT_DISPATCH_CONTENT_KEY,
  commentAnchorLabel,
  groupCommentsByArtifact,
  parseArtifactComments,
  resolveCommentThreads,
  sendArtifactComment,
  sendCommentDispatch,
} from './artifact-comment';

function msg(overrides: {
  body: string;
  artifact: string;
  line?: number;
  coordinate?: { x: number; y: number };
  ts: number;
  sender?: string;
  action?: 'resolve';
  resolvesTs?: number;
}) {
  return {
    type: 'm.room.message',
    origin_server_ts: overrides.ts,
    sender: overrides.sender ?? '@alice:example.org',
    event_id: `$e${overrides.ts}`,
    content: {
      msgtype: 'm.text',
      body: overrides.body,
      'com.agentteams.artifact_comment': {
        artifact: overrides.artifact,
        author: overrides.sender ?? '@alice:example.org',
        ...(overrides.line !== undefined ? { line: overrides.line } : {}),
        ...(overrides.coordinate ? { coordinate: overrides.coordinate } : {}),
        ...(overrides.action ? { action: overrides.action, resolves_ts: overrides.resolvesTs } : {}),
      },
    },
  };
}

describe('parseArtifactComments（F6.2）', () => {
  it('从 /messages chunk 提取评论（升序），非消息/缺元数据剔除', () => {
    const chunk = {
      chunk: [
        msg({ body: 'L3 这里越界', artifact: 'index.html', line: 3, ts: 200 }),
        { type: 'm.room.message', origin_server_ts: 150, content: { body: '普通消息' } },
        msg({ body: '整文件备注', artifact: 'index.html', ts: 100 }),
        { type: 'm.reaction', content: {} },
      ],
    };
    const comments = parseArtifactComments(chunk);
    expect(comments.map((c) => c.body)).toEqual(['整文件备注', 'L3 这里越界']);
    expect(comments[1].line).toBe(3);
  });

  it('非数组/空 chunk 安全返回空', () => {
    expect(parseArtifactComments(null)).toEqual([]);
    expect(parseArtifactComments({})).toEqual([]);
  });
});

describe('resolveCommentThreads（F6.2 解决状态回溯）', () => {
  it('resolve 事件归并到原评论（resolvedBy/resolvedAt），本体剔除 resolve 条目', () => {
    const comments = parseArtifactComments({
      chunk: [
        msg({ body: '标题拼写错误', artifact: 'a.md', line: 1, ts: 100 }),
        msg({
          body: '[工件评论] 已解决：a.md（L1）',
          artifact: 'a.md',
          ts: 300,
          sender: '@bob:example.org',
          action: 'resolve',
          resolvesTs: 100,
        }),
      ],
    });
    const threads = resolveCommentThreads(comments);
    expect(threads).toHaveLength(1);
    expect(threads[0].resolvedBy).toBe('@bob:example.org');
    expect(threads[0].resolvedAt).toBe(300);
  });

  it('未解决的评论保持无 resolvedBy', () => {
    const threads = resolveCommentThreads(
      parseArtifactComments({ chunk: [msg({ body: '待办', artifact: 'a.md', ts: 5 })] }),
    );
    expect(threads[0].resolvedBy).toBeUndefined();
  });
});

describe('图片坐标锚点（E-1）', () => {
  it('解析 0–1 坐标；越界与非数字丢弃，不编假锚点', () => {
    const comments = parseArtifactComments({
      chunk: [
        msg({ body: '按钮偏了', artifact: 'shot.png', coordinate: { x: 0.42, y: 0.65 }, ts: 100 }),
        msg({ body: '越界', artifact: 'shot.png', coordinate: { x: 1.4, y: 0.2 }, ts: 200 }),
        msg({
          body: '非数字',
          artifact: 'shot.png',
          coordinate: { x: NaN, y: 0.2 } as unknown as { x: number; y: number },
          ts: 300,
        }),
      ],
    });
    expect(comments[0].coordinate).toEqual({ x: 0.42, y: 0.65 });
    expect(comments[1].coordinate).toBeUndefined();
    expect(comments[2].coordinate).toBeUndefined();
  });

  it('commentAnchorLabel 区分行 / 坐标 / 全文', () => {
    expect(commentAnchorLabel({ line: 3 })).toBe('L3');
    expect(commentAnchorLabel({ coordinate: { x: 0.42, y: 0.65 } })).toBe('(42%, 65%)');
    expect(commentAnchorLabel({})).toBe('全文');
  });

  it('发送坐标评论时元数据与可读正文同时带锚点', async () => {
    vi.mocked(matrixProxyFetch).mockClear();
    await sendArtifactComment({
      roomId: '!r:server',
      artifact: 'shot.png',
      body: '这里按钮偏了',
      author: '@alice:server',
      coordinate: { x: 0.42, y: 0.65 },
    });
    const [, init] = vi.mocked(matrixProxyFetch).mock.calls[0] as [string, RequestInit];
    const payload = JSON.parse(String(init.body)) as {
      body: string;
      'com.agentteams.artifact_comment': Record<string, unknown>;
    };
    expect(payload['com.agentteams.artifact_comment'].coordinate).toEqual({ x: 0.42, y: 0.65 });
    expect(payload.body).toContain('(42%, 65%)');
  });
});

describe('工件侧聚合（E-1）', () => {
  it('按工件分组，并各自归并解决状态', () => {
    const comments = parseArtifactComments({
      chunk: [
        msg({ body: 'A 的行问题', artifact: 'a.md', line: 2, ts: 100 }),
        msg({ body: 'B 的坐标问题', artifact: 'b.png', coordinate: { x: 0.1, y: 0.2 }, ts: 150 }),
        msg({
          body: '已解决 a.md',
          artifact: 'a.md',
          ts: 200,
          sender: '@bob:server',
          action: 'resolve',
          resolvesTs: 100,
        }),
      ],
    });
    const groups = groupCommentsByArtifact(comments);
    expect([...groups.keys()].sort()).toEqual(['a.md', 'b.png']);
    expect(groups.get('a.md')?.[0].resolvedBy).toBe('@bob:server');
    expect(groups.get('b.png')?.[0].resolvedBy).toBeUndefined();
  });
});

describe('结构化派发（E-2）', () => {
  it('正文可读且携带 comment_dispatch 结构化载荷', async () => {
    vi.mocked(matrixProxyFetch).mockClear();
    await sendCommentDispatch({
      roomId: '!r:server',
      artifact: 'shot.png',
      assignee: 'dev-bot',
      dispatchedBy: '@alice:server',
      comments: [
        { artifact: 'shot.png', body: '按钮偏了', author: '@alice:server', ts: 100, coordinate: { x: 0.42, y: 0.65 } },
        { artifact: 'shot.png', body: '文案太长', author: '@bob:server', ts: 200, line: 7 },
      ],
    });
    const [path, init] = vi.mocked(matrixProxyFetch).mock.calls[0] as [string, RequestInit];
    expect(path).toContain('/send');
    const payload = JSON.parse(String(init.body)) as {
      body: string;
      [COMMENT_DISPATCH_CONTENT_KEY]: {
        assignee: string;
        artifact: string;
        comments: Array<Record<string, unknown>>;
      };
    };
    const dispatch = payload[COMMENT_DISPATCH_CONTENT_KEY];
    expect(dispatch.assignee).toBe('dev-bot');
    expect(dispatch.artifact).toBe('shot.png');
    expect(dispatch.comments).toHaveLength(2);
    expect(dispatch.comments[0].coordinate).toEqual({ x: 0.42, y: 0.65 });
    expect(payload.body).toContain('@dev-bot');
    expect(payload.body).toContain('(42%, 65%)');
    expect(payload.body).toContain('L7');
  });

  it('空指派或空选择直接抛错，不发请求', async () => {
    vi.mocked(matrixProxyFetch).mockClear();
    await expect(
      sendCommentDispatch({
        roomId: '!r:server',
        artifact: 'a.md',
        assignee: '  ',
        dispatchedBy: '@alice:server',
        comments: [{ artifact: 'a.md', body: 'x', author: '@a:server', ts: 1 }],
      }),
    ).rejects.toThrow('指派对象不能为空');
    await expect(
      sendCommentDispatch({
        roomId: '!r:server',
        artifact: 'a.md',
        assignee: 'dev-bot',
        dispatchedBy: '@alice:server',
        comments: [],
      }),
    ).rejects.toThrow('请至少选择一条评论');
    expect(matrixProxyFetch).not.toHaveBeenCalled();
  });
});
