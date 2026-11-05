import { describe, expect, it } from 'vitest';
import {
  reconstructMatrixEvent,
  parseReplayJsonl,
  assembleReplayTimeline,
} from './assemble-replay';

describe('assemble-replay: reconstructMatrixEvent', () => {
  it('正确还原拍平导出的 m.room.message 事件', () => {
    const record = {
      event_id: '$msg_01',
      type: 'm.room.message',
      sender: '@worker_coder:local',
      timestamp: 1730000000000,
      msgtype: 'm.text',
      body: '任务开始执行',
      format: 'org.matrix.custom.html',
      relates_to: { rel_type: 'm.thread', event_id: '$root_01' },
    };

    const ev = reconstructMatrixEvent(record);
    expect(ev).not.toBeNull();
    expect(ev?.event_id).toBe('$msg_01');
    expect(ev?.type).toBe('m.room.message');
    expect(ev?.sender).toBe('@worker_coder:local');
    expect(ev?.origin_server_ts).toBe(1730000000000);
    expect(ev?.content).toEqual({
      msgtype: 'm.text',
      body: '任务开始执行',
      format: 'org.matrix.custom.html',
      'm.relates_to': { rel_type: 'm.thread', event_id: '$root_01' },
    });
  });

  it('缺少关键字段时返回 null', () => {
    expect(reconstructMatrixEvent({ event_id: '$1' })).toBeNull();
    expect(reconstructMatrixEvent({ type: 'm.text' })).toBeNull();
  });
});

describe('assemble-replay: parseReplayJsonl', () => {
  it('解析多行 JSONL 并跳过空行与损坏行', () => {
    const jsonl = [
      JSON.stringify({ event_id: '$1', type: 'm.room.message', sender: '@a:local', timestamp: 100 }),
      '',
      '{ broken json ',
      JSON.stringify({ event_id: '$2', type: 'm.room.message', sender: '@b:local', timestamp: 200 }),
    ].join('\n');

    const events = parseReplayJsonl(jsonl);
    expect(events).toHaveLength(2);
    expect(events[0].event_id).toBe('$1');
    expect(events[1].event_id).toBe('$2');
  });
});

describe('assemble-replay: assembleReplayTimeline', () => {
  it('装配工作流时间线，思考与工具调用块正确关联', () => {
    const rawEvents = [
      {
        event_id: '$root',
        type: 'm.room.message',
        sender: '@worker_1:local',
        origin_server_ts: 1000,
        content: { msgtype: 'm.notice', body: '正在规划...' },
      },
      {
        event_id: '$step1',
        type: 'm.room.message',
        sender: '@worker_1:local',
        origin_server_ts: 2000,
        content: {
          msgtype: 'm.notice',
          body: 'Thinking:\n\n分析仓库结构',
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
        },
      },
      {
        event_id: '$step2',
        type: 'm.room.message',
        sender: '@worker_1:local',
        origin_server_ts: 3000,
        content: {
          msgtype: 'm.text',
          body: '🔧 **execute_shell_command**\n```json\n{"command":"git status"}\n```',
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
        },
      },
      {
        event_id: '$answer',
        type: 'm.room.message',
        sender: '@worker_1:local',
        origin_server_ts: 4000,
        content: {
          msgtype: 'm.text',
          body: '* 完成分析',
          'm.relates_to': { rel_type: 'm.replace', event_id: '$root' },
          'm.new_content': { msgtype: 'm.text', body: '分析完毕，工作区干净' },
        },
      },
    ];

    const messages = assembleReplayTimeline(rawEvents);
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe('$root');
    expect(messages[0].content).toBe('分析完毕，工作区干净');
    // 验证 precomputedBlocks 中包含了 thinking 和 tool_call
    const blockTypes = messages[0].precomputedBlocks?.map((b) => b.type);
    expect(blockTypes).toContain('thinking');
    expect(blockTypes).toContain('tool_call');
  });

  it('f3-4：人类 sender 纯文本不盖 workerName、保持独立气泡且不被选为回合答案', () => {
    // 时间线：人类提问 → worker 回答（含 thinking 折叠）→ 人类追问。
    // 在线渲染中三条是独立气泡；回放装配必须同构。
    const rawEvents = [
      {
        event_id: '$q1',
        type: 'm.room.message',
        sender: '@alice:local',
        origin_server_ts: 1000,
        content: { msgtype: 'm.text', body: '帮我检查构建失败的原因' },
      },
      {
        event_id: '$root',
        type: 'm.room.message',
        sender: '@worker_1:local',
        origin_server_ts: 2000,
        content: { msgtype: 'm.notice', body: '正在排查...' },
      },
      {
        event_id: '$step',
        type: 'm.room.message',
        sender: '@worker_1:local',
        origin_server_ts: 3000,
        content: {
          msgtype: 'm.notice',
          body: 'Thinking:\n\n查看 CI 日志',
          'm.relates_to': { rel_type: 'm.thread', event_id: '$root' },
        },
      },
      {
        event_id: '$answer',
        type: 'm.room.message',
        sender: '@worker_1:local',
        origin_server_ts: 4000,
        content: {
          msgtype: 'm.text',
          body: '* 结论',
          'm.relates_to': { rel_type: 'm.replace', event_id: '$root' },
          'm.new_content': { msgtype: 'm.text', body: '结论：依赖版本冲突' },
        },
      },
      {
        event_id: '$q2',
        type: 'm.room.message',
        sender: '@alice:local',
        origin_server_ts: 5000,
        content: { msgtype: 'm.text', body: '那怎么修？' },
      },
    ];

    const messages = assembleReplayTimeline(rawEvents);

    // 人类消息：不盖 workerName（DisplayMessage.workerName 为可选字段，未盖即
    // undefined——语义同在线渲染的「非 worker 不建 map」），不进入任何回合。
    const human = messages.filter((message) => message.sender === '@alice:local');
    expect(human).toHaveLength(2);
    for (const message of human) {
      expect(message.workerName).toBeUndefined();
      expect(message.turnState).toBeUndefined();
    }

    // worker 侧：思考折叠不回归，回答仍是 worker 自己的 m.replace，人类文本
    // 未被 chooseAnswer 拿去当回合答案。
    const workerTurn = messages.find((message) => message.id === '$root');
    expect(workerTurn).toBeDefined();
    expect(workerTurn?.content).toBe('结论：依赖版本冲突');
    expect(workerTurn?.precomputedBlocks?.map((block) => block.type)).toContain('thinking');
    expect(messages.filter((message) => message.sender === '@worker_1:local')).toHaveLength(1);
  });
});
