import { describe, expect, it } from 'vitest';
import {
  parseArtifactComments,
  resolveCommentThreads,
} from './artifact-comment';

function msg(overrides: {
  body: string;
  artifact: string;
  line?: number;
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
