/**
 * #235：QwenPaw 工具护栏通道审批模板（`format_channel_approval_body`）
 * → confirmation payload 解析。模板实锤见 QwenPaw
 * src/qwenpaw/security/tool_guard/approval.py。
 */

import { describe, expect, it } from 'vitest';
import { parseRuntimeApprovalConfirmation } from './parser';

const SAMPLE = [
  '\u{1F6E1}\u{FE0F} **Approval Required**',
  '',
  '\u2022 **Tool**: `execute_shell_command`',
  '\u2022 **Severity**: \u{1F534} CRITICAL',
  '\u2022 **Findings**: 3',
  '',
  '**Risk Details:**',
  '- [CRITICAL] 递归删除高危命令',
  '- [MEDIUM] 覆盖未确认路径',
  '- ... and 1 more',
  '',
  '**Parameters:**',
  '```json',
  '{',
  '  "command": "rm -rf /tmp/build"',
  '}',
  '```',
  '',
  '\u{1F4A1} **Actions**',
  '- Approve: `/approval approve`',
  '- Deny: `/approval deny`',
  '- Cancel: `/approval cancel`',
  '- List: `/approval list`',
].join('\n');

describe('parseRuntimeApprovalConfirmation（#235）', () => {
  it('parses every field of the shipped QwenPaw template', () => {
    const payload = parseRuntimeApprovalConfirmation(SAMPLE);
    expect(payload).toMatchObject({
      runtime: 'Tool Guard',
      toolName: 'execute_shell_command',
      severity: 'CRITICAL',
      findings: 3,
      // 行首项目符号剥掉，只留内容。
      riskDetails: ['[CRITICAL] 递归删除高危命令', '[MEDIUM] 覆盖未确认路径', '... and 1 more'].join('\n'),
      approveReply: '/approval approve',
      rejectReply: '/approval deny',
      cancelReply: '/approval cancel',
    });
    expect(payload?.parameters).toContain('"command": "rm -rf /tmp/build"');
    // 模板不带请求 ID：调用方据此禁绑按钮。
    expect(payload?.requestId).toBeUndefined();
  });

  it('keeps the no-findings variant (inline sentence, no Risk Details section)', () => {
    const body = [
      '\u{1F6E1}\u{FE0F} **Approval Required**',
      '',
      '\u2022 **Tool**: `read_file`',
      '\u2022 **Severity**: \u{1F7E2} LOW',
      '\u2022 **Findings**: 0',
      '',
      'No specific risk rules matched.',
      '',
      '**Parameters:**',
      '```json',
      '{ "path": "~/SOUL.md" }',
      '```',
      '',
      '\u{1F4A1} **Actions**',
      '- Approve: `/approval approve`',
      '- Deny: `/approval deny`',
    ].join('\n');

    const payload = parseRuntimeApprovalConfirmation(body);
    expect(payload).toMatchObject({
      toolName: 'read_file',
      severity: 'LOW',
      riskDetails: 'No specific risk rules matched.',
      approveReply: '/approval approve',
      rejectReply: '/approval deny',
    });
    expect(payload?.cancelReply).toBeUndefined();
  });

  it('omits optional sections when the template drops parameters entirely', () => {
    const body = [
      '\u{1F6E1}\u{FE0F} **Approval Required**',
      '',
      '\u2022 **Tool**: `view_image`',
      '\u2022 **Severity**: \u{1F7E1} MEDIUM',
      '\u2022 **Findings**: 1',
      '',
      '**Risk Details:**',
      '- [MEDIUM] 大图可能超时',
      '',
      '\u{1F4A1} **Actions**',
      '- Approve: `/approval approve`',
      '- Deny: `/approval deny`',
    ].join('\n');

    const payload = parseRuntimeApprovalConfirmation(body);
    expect(payload?.parameters).toBeUndefined();
    expect(payload?.findings).toBe(1);
    expect(payload?.riskDetails).toBe('[MEDIUM] 大图可能超时');
  });

  it('binds commands to the request id when a template variant carries one', () => {
    const body = [
      '\u{1F6E1}\u{FE0F} **Approval Required**',
      '',
      '\u2022 **Tool**: `execute_shell_command`',
      '\u2022 **Severity**: \u{1F534} HIGH',
      '\u2022 **Findings**: 2',
      '\u2022 **Request ID**: `req-abc-123`',
      '',
      '**Risk Details:**',
      '- [HIGH] 删除工作区文件',
      '',
      '**Parameters:**',
      '```json',
      '{ "command": "rm -rf dist" }',
      '```',
      '',
      '\u{1F4A1} **Actions**',
      '- Approve: `/approval approve`',
      '- Deny: `/approval deny`',
    ].join('\n');

    const payload = parseRuntimeApprovalConfirmation(body);
    expect(payload?.requestId).toBe('req-abc-123');
    expect(payload?.approveReply).toBe('/approval approve req-abc-123');
    expect(payload?.rejectReply).toBe('/approval deny req-abc-123');
  });

  it('accepts an id already present on the documented command line', () => {
    const body = [
      '\u{1F6E1}\u{FE0F} **Approval Required**',
      '',
      '\u2022 **Tool**: `bash`',
      '\u2022 **Severity**: LOW',
      '',
      '\u{1F4A1} **Actions**',
      '- Approve: `/approval approve 7f3c9d2e-1a4b-4c5d-8e9f-0a1b2c3d4e5f`',
      '- Deny: `/approval deny 7f3c9d2e-1a4b-4c5d-8e9f-0a1b2c3d4e5f`',
    ].join('\n');

    const payload = parseRuntimeApprovalConfirmation(body);
    expect(payload?.requestId).toBe('7f3c9d2e-1a4b-4c5d-8e9f-0a1b2c3d4e5f');
    // 已带 ID 的命令保持原样，不重复追加。
    expect(payload?.approveReply).toBe('/approval approve 7f3c9d2e-1a4b-4c5d-8e9f-0a1b2c3d4e5f');
    expect(payload?.severity).toBe('LOW');
  });

  it('does not mistake a UUID inside tool parameters for the request id', () => {
    const body = [
      '\u{1F6E1}\u{FE0F} **Approval Required**',
      '',
      '\u2022 **Tool**: `mcp_write`',
      '\u2022 **Severity**: INFO',
      '\u2022 **Findings**: 1',
      '',
      '**Parameters:**',
      '```json',
      '{ "trace_id": "7f3c9d2e-1a4b-4c5d-8e9f-0a1b2c3d4e5f" }',
      '```',
      '',
      '\u{1F4A1} **Actions**',
      '- Approve: `/approval approve`',
      '- Deny: `/approval deny`',
    ].join('\n');

    expect(parseRuntimeApprovalConfirmation(body)?.requestId).toBeUndefined();
  });

  it('returns null for ordinary text (signature alone is not enough)', () => {
    expect(parseRuntimeApprovalConfirmation('Approval Required\n\n请人工审批')).toBeNull();
  });

  it('returns null when the action list is absent', () => {
    const body = [
      '\u{1F6E1}\u{FE0F} **Approval Required**',
      '',
      '\u2022 **Tool**: `execute_shell_command`',
      '\u2022 **Severity**: CRITICAL',
    ].join('\n');
    expect(parseRuntimeApprovalConfirmation(body)).toBeNull();
  });

  it('returns null for the legacy Tool Guard prompt (different template)', () => {
    const legacy = '\u23F3 Waiting for approval / 等待审批\n\n**Agent** wants to run a command.\n\nType /approve to approve, or send any message to deny.';
    expect(parseRuntimeApprovalConfirmation(legacy)).toBeNull();
  });

  it('returns null for an empty body', () => {
    expect(parseRuntimeApprovalConfirmation('')).toBeNull();
  });
});
