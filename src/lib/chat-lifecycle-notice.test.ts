import { describe, expect, it } from 'vitest';
import { isManagerSender, parseWorkerLifecycleNotice } from './chat-lifecycle-notice';

describe('parseWorkerLifecycleNotice', () => {
  it('parses the controller pause announcement', () => {
    expect(
      parseWorkerLifecycleNotice(
        'Worker ceshi container has been automatically paused due to idle timeout. It will be automatically resumed when a task is assigned.'
      )
    ).toMatchObject({
      kind: 'paused',
      worker: 'ceshi',
    });
  });

  it('parses the resume announcement', () => {
    expect(
      parseWorkerLifecycleNotice('Worker ceshi container has been automatically resumed.')
    ).toMatchObject({
      kind: 'resumed',
      worker: 'ceshi',
    });
  });

  it('ignores conversation that merely mentions the worker being paused', () => {
    expect(
      parseWorkerLifecycleNotice('刚刚那条系统通知说 Worker ceshi 被暂停了，不用管。')
    ).toBeNull();
    expect(parseWorkerLifecycleNotice('Worker ceshi is thinking.')).toBeNull();
    expect(parseWorkerLifecycleNotice('')).toBeNull();
  });
});

describe('isManagerSender', () => {
  it('accepts the manager localpart or display name', () => {
    expect(isManagerSender('@manager:matrix-local.agentteams.io:18080')).toBe(true);
    expect(isManagerSender('@ctl:example.com', 'Manager')).toBe(true);
  });

  it('rejects workers and humans', () => {
    expect(isManagerSender('@ceshi:example.com', 'ceshi')).toBe(false);
    expect(isManagerSender('@admin:example.com', '管理员')).toBe(false);
  });
});
