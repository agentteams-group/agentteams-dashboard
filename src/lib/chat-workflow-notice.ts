/** Presentation of the fixed TeamHarness notification formats, not prose. */
export interface WorkflowNotice {
  kind: 'project' | 'assigned' | 'submitted' | 'revision' | 'blocked' | 'interrupted' | 'requested' | 'artifact' | 'progress';
  title: string;
  subject?: string;
  description?: string;
  attention?: boolean;
  body: string;
}

export function parseWorkflowNotice(body: string | null | undefined, runtime?: string | null): WorkflowNotice | null {
  if (!body) return null;
  const codexProgress = runtime === 'codex' && /^Codex is working: (commandExecution|mcpToolCall|fileChange)\.$/.exec(body.trim());
  if (codexProgress) {
    const labels: Record<string, string> = { commandExecution: '正在执行命令', mcpToolCall: '正在调用工具', fileChange: '正在修改文件' };
    return { kind: 'progress', title: labels[codexProgress[1]], body };
  }
  const text = body.trim().replace(/^(?:@\S+\s+)+/, '');
  const flow = /^\[ProjectFlow\]\s+([a-z_]+(?:\s*\+\s*[a-z_]+)*):\s*([\s\S]*)$/.exec(text);
  if (flow) {
    const action = flow[1].trim();
    const subject = /项目[「“"]([^」”"]+)[」”"]/.exec(flow[2])?.[1];
    let title = '项目进度已更新';
    let description: string | undefined;
    if (/\bcreate_(?:quick_)?project\b/.test(action)) title = '项目已启动';
    if (/\bplan_(?:dag|loop)\b/.test(action)) {
      if (title === '项目进度已更新') title = '执行计划已更新';
      description = '执行计划已生成';
    }
    if (/\bdelegate_task\b/.test(action)) title = '任务已分配';
    if (/\baccept_task_result\b/.test(action)) title = '任务验收已更新';
    if (/\bpause(?:_project)?\b/.test(action)) title = '项目已暂停';
    if (/\bresume(?:_project)?\b/.test(action)) title = '项目已恢复';
    if (/\bcomplete(?:_project)?\b/.test(action)) title = '项目已完成';
    return { kind: 'project', title, subject, description, body };
  }

  const assignment = /^You are assigned task \*\*[^*]+\*\*:\s*([^\n]+)/.exec(text);
  if (assignment) {
    const assignee = /^@([^:\s]+):/.exec(body.trim())?.[1];
    return { kind: 'assigned', title: '任务已分配', subject: assignment[1].trim(), description: assignee ? '执行者：' + assignee : undefined, body };
  }

  const request = /^PROJECT_REQUESTED:\s*([^\n]+)/.exec(text);
  if (request) return { kind: 'requested', title: '项目请求已转交', subject: request[1].trim(), body };

  const task = /^TASK_(COMPLETED|ASSIGNED|REVISION_NEEDED|BLOCKED|INTERRUPTED):\s*\S+(?:\s+-\s+([\s\S]*))?$/.exec(text);
  if (task) {
    const states = {
      COMPLETED: { kind: 'submitted', title: '任务已提交', description: '等待验收' },
      ASSIGNED: { kind: 'assigned', title: '任务已分配' },
      REVISION_NEEDED: { kind: 'revision', title: '任务需要修订', attention: true },
      BLOCKED: { kind: 'blocked', title: '任务已阻塞', attention: true },
      INTERRUPTED: { kind: 'interrupted', title: '任务已中断', attention: true },
    } as const;
    const state = states[task[1] as keyof typeof states];
    return { ...state, ...(!['COMPLETED', 'ASSIGNED'].includes(task[1]) && task[2] ? { description: task[2].trim().slice(0, 180) } : {}), body };
  }

  const artifact = /^📎 已发布 (.+?)（([^）]+)）\s*[—-]/.exec(text);
  if (artifact) return { kind: 'artifact', title: '交付文件已更新', subject: artifact[1], description: artifact[2], body };
  return null;
}
