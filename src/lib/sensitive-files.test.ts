import { describe, expect, it } from 'vitest';
import { isSensitiveFileName, isSensitiveObjectKey } from './sensitive-files';

describe('sensitive-files（对齐 workbench 插件 _kb_is_sensitive）', () => {
  it.each([
    ['openclaw.json', 'openclaw.json'],
    ['foo.lock', 'foo.lock'],
    ['foo.lock', 'memory/foo.lock'],
    ['id_rsa', '.ssh/id_rsa'],
    ['config.yaml', '.hermes/config.yaml'],
    ['x.yaml', 'credentials/x.yaml'],
    // 插件 _kb_is_sensitive 实码（9/16 对照 router.py L2415-2425）：
    // rel == "credentials"（目录条目本身）同样过滤
    ['credentials', 'credentials'],
    // B1（维护者 1.2.4 联调验收报告）：credentials.yaml 独立凭证文件
    // （不在 credentials/ 目录下）必须过滤——插件侧已同步补规则
    ['credentials.yaml', 'credentials.yaml'],
    ['credentials.yml', 'credentials.yml'],
    ['credentials.yaml', 'secrets/credentials.yaml'],
    ['worker.token', 'worker.token'],
    ['service-account.token', 'workers/demo/service-account.token'],
  ])('敏感：name=%s rel=%s → true', (name, rel) => {
    expect(isSensitiveFileName(name, rel)).toBe(true);
  });

  it.each([
    ['MEMORY.md', 'MEMORY.md'],
    ['a.md', 'memory/2026-09-15.md'],
    ['agent.json', 'agent.json'],
    ['notes.md', 'digest/notes.md'],
    // 近似名不放行（模式精确匹配，不误伤）
    ['my-credentials.yaml', 'my-credentials.yaml'],
    ['crednotes.md', 'digest/crednotes.md'],
  ]  )('放行：name=%s rel=%s → false', (name, rel) => {
    expect(isSensitiveFileName(name, rel)).toBe(false);
  });
});

describe('isSensitiveObjectKey（bucket 键，含任意前缀）', () => {
  it.each([
    // basename 命中：任意前缀下的独立凭证文件
    'workers/demo/credentials.yaml',
    'workers/demo/worker.token',
    'workers/demo/service-account.token',
    'teams/t1/shared/credentials.yml',
    // 嵌套前缀下的敏感目录（isSensitiveFileName 顶层规则测不到的场景）
    'workers/demo/.ssh/id_rsa',
    'workers/demo/.hermes/config.yaml',
    'teams/t1/credentials/api-key.txt',
    // .lock 通配
    'workers/demo/memory/session.lock',
  ])('敏感：%s → true', (key) => {
    expect(isSensitiveObjectKey(key)).toBe(true);
  });

  it.each([
    'workers/demo/README.md',
    'teams/t1/shared/report.pdf',
    // 近似名不误伤
    'workers/demo/my-credentials.yaml',
    'memory/2026-09-15.md',
  ])('放行：%s → false', (key) => {
    expect(isSensitiveObjectKey(key)).toBe(false);
  });

  it('无前缀裸键退化为 isSensitiveFileName 语义', () => {
    expect(isSensitiveObjectKey('credentials.yaml')).toBe(true);
    expect(isSensitiveObjectKey('.ssh/id_rsa')).toBe(true);
    expect(isSensitiveObjectKey('README.md')).toBe(false);
  });
});
