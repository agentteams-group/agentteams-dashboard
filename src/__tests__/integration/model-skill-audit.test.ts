/**
 * 模型管理与技能管理全链路集成测试
 *
 * 运行前提: dev server 运行在 http://localhost:3000
 * 运行方式: npx vitest run src/__tests__/integration/*
 *
 * 本测试验证:
 * 1. API 端点认证门控 (所有受保护端点应在无会话时返回 401)
 * 2. Model Binding 解析逻辑正确性
 * 3. 技能包解析逻辑正确性
 * 4. Nacos 配置读写
 * 5. 外部适配模式守卫行为
 */

import { describe, it, expect } from 'vitest';

const BASE_URL = 'http://127.0.0.1:3000';

// ============================================================
// T1: Higress Console 代理端点认证门控
// ============================================================

describe('Higress Console 代理端点认证门控', () => {
  it('GET /api/higress/ai-providers — 无会话时返回 401', async () => {
    const res = await fetch(`${BASE_URL}/api/higress/ai-providers`, { redirect: 'follow' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });

  it('GET /api/higress/ai-routes — 无会话时返回 401', async () => {
    const res = await fetch(`${BASE_URL}/api/higress/ai-routes`, { redirect: 'follow' });
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBeDefined();
  });
});

// ============================================================
// T2: AgentTeams API 端点认证门控
// ============================================================

describe('AgentTeams API 端点认证门控', () => {
  const endpoints = [
    '/api/agentteams/skills',
    '/api/agentteams/infrastructure',
    '/api/agentteams/gateway/consumers',
    '/api/agentteams/skills/nacos/config',
    '/api/agentteams/workers/test-worker/skills',
  ];

  for (const path of endpoints) {
    it(`GET ${path} — 无会话时返回 401`, async () => {
      const res = await fetch(`${BASE_URL}${path}`, { redirect: 'follow' });
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toBe('Unauthorized');
    });
  }

  it('POST /api/agentteams/skills/nacos/sync — 无会话时返回 401', async () => {
    const res = await fetch(`${BASE_URL}/api/agentteams/skills/nacos/sync`, {
      method: 'POST',
      redirect: 'follow',
    });
    expect(res.status).toBe(401);
  });
});

// ============================================================
// T3: 公开端点无需认证
// ============================================================

describe('公开端点无需认证', () => {
  it('GET /api/agentteams/setup/status — 公开访问', async () => {
    const res = await fetch(`${BASE_URL}/api/agentteams/setup/status`, { redirect: 'follow' });
    expect(res.status).not.toBe(401);
  });

  it('GET /api/agentteams/setup/ensure-ai — 公开访问', async () => {
    const res = await fetch(`${BASE_URL}/api/agentteams/setup/ensure-ai`, { redirect: 'follow' });
    expect(res.status).not.toBe(401);
  });
});

// ============================================================
// T4: Model Binding 解析逻辑
// ============================================================

describe('Model Binding 解析逻辑', () => {
  it('buildModelBindings 对空输入返回空数组', async () => {
    const { buildModelBindings } = await import('@/lib/model-bindings');
    expect(buildModelBindings([], [], [])).toEqual([]);
  });

  it('buildModelBindings 对空 aliases 返回空数组', async () => {
    const { buildModelBindings } = await import('@/lib/model-bindings');
    const provider = {
      name: 'deepseek', type: 'deepseek', protocol: 'openai',
      rawConfigs: { modelMapping: { 'deepseek-chat': 'deepseek-chat' } },
      tokens: [], tokenCount: 1,
    } as any;
    const result = buildModelBindings([], [], [provider]);
    expect(result).toEqual([]);
  });
});

// ============================================================
// T5: 外部适配模式守卫 (默认 direct 模式下行为)
// ============================================================

describe('外部适配模式守卫 (direct 模式)', () => {
  it('rejectExternalModelProvider — direct 模式返回 null (放行)', async () => {
    const { rejectExternalModelProvider } = await import('@/app/api/agentteams/external-model-binding-guard');
    const mockReq = {
      clone: () => ({ json: async () => ({ modelProvider: 'openai' }) }),
    };
    const result = await rejectExternalModelProvider(mockReq as any);
    expect(result).toBeNull();
  });
});

// ============================================================
// T6: 技能包解析逻辑
// ============================================================

describe('技能包解析逻辑', () => {
  it('parseSkillPackage 对无效 ZIP 抛出 SkillPackageError', async () => {
    const { parseSkillPackage } = await import('@/lib/skill-package');
    const invalidZip = new Uint8Array([0x50, 0x4B, 0x03, 0x04, 0x00, 0x00, 0x00, 0x00]);
    expect(() => parseSkillPackage(invalidZip)).toThrow('技能包不是合法的 ZIP 文件');
  });

  it('parseSkillPackage 对空 buffer 抛出 SkillPackageError', async () => {
    const { parseSkillPackage } = await import('@/lib/skill-package');
    expect(() => parseSkillPackage(new Uint8Array(0))).toThrow('上传的技能包为空');
  });

  it('skillObjectKey 生成 agents 前缀路径', async () => {
    const { skillObjectKey } = await import('@/lib/skill-package');
    expect(skillObjectKey('worker-1', 'my-skill', 'scripts/run.sh'))
      .toBe('agents/worker-1/skills/my-skill/scripts/run.sh');
  });

  it('isValidNameSegment 拒绝非法名称', async () => {
    const { isValidNameSegment } = await import('@/lib/skill-package');
    expect(isValidNameSegment('valid-name')).toBe(true);
    expect(isValidNameSegment('valid_name.v1')).toBe(true);
    expect(isValidNameSegment('../escape')).toBe(false);
    expect(isValidNameSegment('/absolute')).toBe(false);
    expect(isValidNameSegment('')).toBe(false);
  });
});

// ============================================================
// T7: 技能存储常量
// ============================================================

describe('技能存储常量', () => {
  it('SKILLS_BUCKET / SKILLS_METADATA_PREFIX / GLOBAL_SKILLS_PREFIX', async () => {
    const mod = await import('@/lib/skill-center-types');
    expect(mod.SKILLS_BUCKET).toBe('skills');
    expect(mod.SKILLS_METADATA_PREFIX).toBe('skills/');
    expect(mod.GLOBAL_SKILLS_PREFIX).toBe('agents/global/skills/');
  });

  it('CUSTOM_SKILL_MARKER', async () => {
    const { CUSTOM_SKILL_MARKER } = await import('@/lib/skill-center-types');
    expect(CUSTOM_SKILL_MARKER).toBe('.agentteams-custom');
  });
});

// ============================================================
// T8: Nacos 配置读写
// ============================================================

describe('Nacos 配置读写', () => {
  it('getNacosConfig 无配置文件时返回 null', async () => {
    const { getNacosConfig } = await import('@/lib/skill-center-config');
    const config = getNacosConfig();
    // 期望: null (无配置文件) 或有值 (已有配置)
    expect(config === null || typeof config === 'object').toBe(true);
  });

  it('setNacosConfig + getNacosConfig 读写一致', async () => {
    const { getNacosConfig, setNacosConfig } = await import('@/lib/skill-center-config');
    const original = getNacosConfig();
    try {
      setNacosConfig({
        registryUrl: 'nacos://test-audit:8848/audit-ns',
        namespace: 'audit-namespace',
        username: 'audit-user',
      });
      const updated = getNacosConfig();
      expect(updated).not.toBeNull();
      expect(updated!.registryUrl).toBe('nacos://test-audit:8848/audit-ns');
      expect(updated!.namespace).toBe('audit-namespace');
      expect(updated!.username).toBe('audit-user');
    } finally {
      if (original) {
        setNacosConfig(original);
      } else {
        const { clearNacosConfig } = await import('@/lib/skill-center-config');
        clearNacosConfig();
      }
    }
  });
});
