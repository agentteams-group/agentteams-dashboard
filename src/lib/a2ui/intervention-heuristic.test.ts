import { describe, expect, it } from 'vitest';
import {
  heuristicToInterventionPayload,
  parseInterventionHeuristic,
} from './intervention-heuristic';

describe('parseInterventionHeuristic（F2.1 降级完整形态）', () => {
  it('问句 + 编号选项 → 升格为干预 payload（Manager 真实回复形态）', () => {
    const body = [
      '收到，先确认一个前提：',
      '',
      '你希望先实现哪一种交互？',
      '1）消息内嵌卡片（推荐）',
      '2）底部快捷操作',
      '3）独立详情面板',
    ].join('\n');
    const result = parseInterventionHeuristic(body);
    expect(result?.question).toBe('你希望先实现哪一种交互？');
    expect(result?.options).toEqual([
      { id: 'opt-1', label: '消息内嵌卡片（推荐）' },
      { id: 'opt-2', label: '底部快捷操作' },
      { id: 'opt-3', label: '独立详情面板' },
    ]);
    expect(result?.before).toBe('收到，先确认一个前提：');
    expect(result?.after).toBe('');
  });

  it('字母 A. B. C. 选项升格；问题行进卡片标题，不进 before', () => {
    const body = [
      '麻烦一次性回答：',
      '**页面类型**：想要哪种？',
      'A. 产品宣传落地页（类似特斯拉官网风格，滚动展示）',
      'B. 3D 交互演示页（可以用鼠标旋转、看飞行汽车模型）',
      'C. 简单的信息展示页（图文介绍这款概念飞行汽车）',
    ].join('\n');
    const result = parseInterventionHeuristic(body);
    expect(result?.question).toBe('页面类型：想要哪种？');
    expect(result?.options).toEqual([
      { id: 'opt-A', label: '产品宣传落地页（类似特斯拉官网风格，滚动展示）' },
      { id: 'opt-B', label: '3D 交互演示页（可以用鼠标旋转、看飞行汽车模型）' },
      { id: 'opt-C', label: '简单的信息展示页（图文介绍这款概念飞行汽车）' },
    ]);
    expect(result?.before).toBe('麻烦一次性回答：');
    expect(result?.after).toBe('');
  });

  it('同一条消息里选项题之后的开放问题进 after，不丢失', () => {
    const body = [
      '以下几个关键问题，麻烦一次性回答：',
      '**页面类型**：想要哪种？',
      'A. 落地页',
      'B. 3D 演示页',
      'C. 信息展示页',
      '**视觉风格**：科技极简还是赛博朋克？',
      '**语言**：全中文、中英双语，还是英文？',
    ].join('\n');
    const result = parseInterventionHeuristic(body);
    expect(result?.options).toHaveLength(3);
    expect(result?.after).toContain('视觉风格');
    expect(result?.after).toContain('语言');
    expect(result?.before).toBe('以下几个关键问题，麻烦一次性回答：');
  });

  it('a) b) 与 A、 风格均认；超过 F 截断到 6 项', () => {
    expect(
      parseInterventionHeuristic('选哪个？\na) 甲\nb) 乙')?.options.map((o) => o.id),
    ).toEqual(['opt-A', 'opt-B']);
    expect(
      parseInterventionHeuristic('选哪个？\nA、甲\nB、乙')?.options.length,
    ).toBe(2);
    const options = 'ABCDEFGHI'
      .split('')
      .map((ch) => `${ch}. 选项${ch}`)
      .join('\n');
    expect(parseInterventionHeuristic(`选哪个？\n${options}`)?.options).toHaveLength(6);
  });

  it('数字与字母不混用；字母不从 A 起编则放弃', () => {
    expect(parseInterventionHeuristic('选哪个？\n1. 甲\nB. 乙')).toBeNull();
    expect(parseInterventionHeuristic('选哪个？\nB. 甲\nC. 乙')).toBeNull();
  });

  it('截图原文（Markdown body）升格为 A/B/C 卡', () => {
    const body = [
      '你好！很高兴接单。在动手之前，我想先把需求弄清楚，避免做出来不是你想要的样子。以下几个关键问题，麻烦一次性回答：',
      '',
      '**页面类型**：想要哪种？',
      'A. 产品宣传落地页（类似特斯拉官网风格，滚动展示）',
      'B. 3D 交互演示页（可以用鼠标旋转、看飞行汽车模型）',
      'C. 简单的信息展示页（图文介绍这款概念飞行汽车）',
      '**视觉风格**：科技极简风（黑/白 + 大图）、赛博朋克风（霓虹、暗色）、还是其他偏好？',
      '**页面内容板块**：希望包含哪些？比如：Hero 大标题、产品参数、飞行原理、价格/预约表单、FAQ……（你说留哪些）',
      '**动效与交互**：纯 CSS 动画就够，还是需要 Three.js 的 3D 飞行汽车模型（可旋转）？',
      '**语言**：全中文、中英双语，还是英文？',
      '**用途**：这个页面是做什么用的？（演示汇报 / 概念作品集 / 活动预热 / 纯好玩） —— 方便我把握调性。',
      '你回完这些，我就直接开做出一个完整的 HTML 文件给你。',
    ].join('\n');
    const result = parseInterventionHeuristic(body);
    expect(result?.question).toBe('页面类型：想要哪种？');
    expect(result?.options.map((o) => o.id)).toEqual(['opt-A', 'opt-B', 'opt-C']);
    expect(result?.after).toContain('视觉风格');
    expect(result?.after).toContain('用途');
  });

  it('formatted_body HTML（QwenPaw 实际形态）仍能升格', () => {
    const html = [
      '<p>以下几个关键问题，麻烦一次性回答：</p>',
      '<p><strong>页面类型</strong>：想要哪种？</p>',
      '<p>A. 产品宣传落地页（类似特斯拉官网风格，滚动展示）</p>',
      '<p>B. 3D 交互演示页（可以用鼠标旋转、看飞行汽车模型）</p>',
      '<p>C. 简单的信息展示页（图文介绍这款概念飞行汽车）</p>',
      '<p><strong>视觉风格</strong>：科技极简还是赛博朋克？</p>',
    ].join('');
    const result = parseInterventionHeuristic(html);
    expect(result?.question).toBe('页面类型：想要哪种？');
    expect(result?.options).toHaveLength(3);
    expect(result?.options[0]).toEqual({
      id: 'opt-A',
      label: '产品宣传落地页（类似特斯拉官网风格，滚动展示）',
    });
    expect(result?.after).toContain('视觉风格');
  });

  it('同一段落内 br 分隔的字母选项也能升格', () => {
    const html =
      '<p>想要哪种？<br>A. 落地页<br>B. 3D 演示页<br>C. 信息展示页</p>';
    expect(parseInterventionHeuristic(html)?.options.map((o) => o.id)).toEqual([
      'opt-A',
      'opt-B',
      'opt-C',
    ]);
  });

  it('引导行以冒号收尾同样命中；1. / 1、 风格均认', () => {
    expect(
      parseInterventionHeuristic('想确认一下你指的是哪个：\n1. 甲\n2. 乙')?.question,
    ).toBe('想确认一下你指的是哪个：');
    expect(
      parseInterventionHeuristic('选哪个？\n1、甲\n2、乙')?.options.length,
    ).toBe(2);
  });

  it('无问句的纯编号列表不升格（防误伤普通列表）', () => {
    expect(parseInterventionHeuristic('步骤如下：\n1. 安装\n2. 启动')).toBeNull();
  });

  it('代码块内编号不参与；编号不连续截断', () => {
    const fenced = '问哪个？\n```\n1) 代码内\n2) 不算\n```\n1) 甲\n2) 乙';
    expect(parseInterventionHeuristic(fenced)?.options).toHaveLength(2);
    const gap = '选哪个？\n1) 甲\n3) 丙';
    expect(parseInterventionHeuristic(gap)).toBeNull();
  });

  it('编号行截断到 9 项（快捷键上限）', () => {
    const options = Array.from({ length: 12 }, (_, i) => `${i + 1}) 选项${i + 1}`).join('\n');
    expect(parseInterventionHeuristic(`选哪个？\n${options}`)?.options).toHaveLength(9);
  });

  it('heuristicToInterventionPayload 补齐 v2 形态', () => {
    const payload = heuristicToInterventionPayload(
      { question: '选哪个？', options: [{ id: 'opt-1', label: '甲' }], before: '', after: '' },
      'heuristic:$evt:1',
    );
    expect(payload).toMatchObject({
      tool_name: 'agent.question',
      confirmation_id: 'heuristic:$evt:1',
      question: '选哪个？',
    });
    expect(payload.options[0].id).toBe('opt-1');
  });
});
