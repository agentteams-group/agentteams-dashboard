import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// --- Mock skill-center-config（保留掩码纯函数，替换 MinIO 读写） ---
const mockGetNacosConfig = vi.fn();
const mockSetNacosConfig = vi.fn();

vi.mock('@/lib/skill-center-config', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/skill-center-config')>();
  return {
    ...actual,
    getNacosConfig: mockGetNacosConfig,
    setNacosConfig: mockSetNacosConfig,
  };
});

// --- Mock audit-log（RBAC 拒绝时写审计，避免落盘） ---
const mockAppendAudit = vi.fn().mockResolvedValue(undefined);
vi.mock('@/lib/audit-log', () => ({
  appendAuditEvent: mockAppendAudit,
}));

// Import after mocking
const { GET, PUT } = await import('./route');
const { NACOS_PASSWORD_MASK } = await import('@/lib/skill-center-config');
const {
  SERVER_USER_HEADER,
  SERVER_USER_LEVEL_HEADER,
  SERVER_USER_SCOPE_HEADER,
  SERVER_USER_TEAMS_HEADER,
  SERVER_USER_WORKERS_HEADER,
} = await import('@/lib/server-auth');

const PLAINTEXT_PASSWORD = 'super-secret-pw';

const SAVED_CONFIG = {
  registryUrl: 'nacos://nacos.local:8848/public',
  namespace: 'public',
  protocol: 'http' as const,
  apiPrefix: '/nacos',
  mode: 'services' as const,
  username: 'nacos',
  password: PLAINTEXT_PASSWORD,
};

function buildGetRequest(level: number | null = 3): NextRequest {
  const headers: Record<string, string> = {};
  if (level !== null) {
    headers[SERVER_USER_HEADER] = `user-${level}`;
    headers[SERVER_USER_LEVEL_HEADER] = String(level);
    headers[SERVER_USER_SCOPE_HEADER] = level === 3 ? 'global' : 'scoped';
    headers[SERVER_USER_TEAMS_HEADER] = JSON.stringify(level === 3 ? [] : ['t1']);
    headers[SERVER_USER_WORKERS_HEADER] = JSON.stringify(level === 3 ? [] : ['worker-1']);
  }
  return new NextRequest('http://localhost/api/agentteams/skills/nacos/config', { headers });
}

function buildPutRequest(
  body: Record<string, unknown>,
  level: number | null = 3,
): NextRequest {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (level !== null) {
    headers[SERVER_USER_HEADER] = `user-${level}`;
    headers[SERVER_USER_LEVEL_HEADER] = String(level);
    headers[SERVER_USER_SCOPE_HEADER] = level === 3 ? 'global' : 'scoped';
    headers[SERVER_USER_TEAMS_HEADER] = JSON.stringify(level === 3 ? [] : ['t1']);
    headers[SERVER_USER_WORKERS_HEADER] = JSON.stringify(level === 3 ? [] : ['worker-1']);
  }
  return new NextRequest('http://localhost/api/agentteams/skills/nacos/config', {
    method: 'PUT',
    headers,
    body: JSON.stringify(body),
  });
}

describe('GET /api/agentteams/skills/nacos/config', () => {
  it('无可信身份头时返回 401，不读取配置', async () => {
    const res = await GET(buildGetRequest(null));
    expect(res.status).toBe(401);
    expect(mockGetNacosConfig).not.toHaveBeenCalled();
  });

  beforeEach(() => {
    vi.resetAllMocks();
    mockGetNacosConfig.mockResolvedValue(null);
  });

  it('已存配置含明文密码时，响应只回掩码占位符，不泄露明文', async () => {
    mockGetNacosConfig.mockResolvedValue({ ...SAVED_CONFIG });

    const res = await GET(buildGetRequest());
    expect(res.status).toBe(200);

    const json = await res.json();
    expect(json.config.password).toBe(NACOS_PASSWORD_MASK);
    expect(JSON.stringify(json)).not.toContain(PLAINTEXT_PASSWORD);
    // 其余字段原样保留
    expect(json.config.registryUrl).toBe(SAVED_CONFIG.registryUrl);
    expect(json.config.username).toBe(SAVED_CONFIG.username);
  });

  it('无已存配置时返回 config: null', async () => {
    const res = await GET(buildGetRequest());
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.config).toBeNull();
  });

  it('已存配置无密码时，响应中不含 password 字段值', async () => {
    mockGetNacosConfig.mockResolvedValue({ ...SAVED_CONFIG, password: undefined });
    const res = await GET(buildGetRequest());
    const json = await res.json();
    expect(json.config.password).toBeUndefined();
  });

  it('level 1 观察者会话可读取配置（view 门放行），但密码仍掩码', async () => {
    mockGetNacosConfig.mockResolvedValue({ ...SAVED_CONFIG });
    const res = await GET(buildGetRequest(1));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.config.password).toBe(NACOS_PASSWORD_MASK);
  });
});

describe('PUT /api/agentteams/skills/nacos/config', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockGetNacosConfig.mockResolvedValue(null);
    mockSetNacosConfig.mockResolvedValue(undefined);
  });

  it('传回掩码占位符时保留存储中的原密码，响应掩码', async () => {
    mockGetNacosConfig.mockResolvedValue({ ...SAVED_CONFIG });

    const res = await PUT(
      buildPutRequest(
        {
          registryUrl: SAVED_CONFIG.registryUrl,
          namespace: 'public',
          username: 'nacos',
          password: NACOS_PASSWORD_MASK,
        },
        3,
      ),
    );
    expect(res.status).toBe(200);

    expect(mockSetNacosConfig).toHaveBeenCalledTimes(1);
    const savedArg = mockSetNacosConfig.mock.calls[0][0];
    expect(savedArg.password).toBe(PLAINTEXT_PASSWORD);

    const json = await res.json();
    expect(json.config.password).toBe(NACOS_PASSWORD_MASK);
    expect(JSON.stringify(json)).not.toContain(PLAINTEXT_PASSWORD);
  });

  it('传入新密码时直接保存新密码', async () => {
    const res = await PUT(
      buildPutRequest(
        {
          registryUrl: SAVED_CONFIG.registryUrl,
          namespace: 'public',
          username: 'nacos',
          password: 'brand-new-pw',
        },
        3,
      ),
    );
    expect(res.status).toBe(200);

    const savedArg = mockSetNacosConfig.mock.calls[0][0];
    expect(savedArg.password).toBe('brand-new-pw');
    expect(JSON.stringify(await res.json())).not.toContain('brand-new-pw');
  });

  it('传回掩码占位符且存储无已存密码时保存为 undefined', async () => {
    const res = await PUT(
      buildPutRequest(
        {
          registryUrl: SAVED_CONFIG.registryUrl,
          namespace: 'public',
          password: NACOS_PASSWORD_MASK,
        },
        3,
      ),
    );
    expect(res.status).toBe(200);

    const savedArg = mockSetNacosConfig.mock.calls[0][0];
    expect(savedArg.password).toBeUndefined();
  });

  it('清空密码时保存为 undefined（清除密码语义不变）', async () => {
    const res = await PUT(
      buildPutRequest(
        {
          registryUrl: SAVED_CONFIG.registryUrl,
          namespace: 'public',
          password: '',
        },
        3,
      ),
    );
    expect(res.status).toBe(200);
    const savedArg = mockSetNacosConfig.mock.calls[0][0];
    expect(savedArg.password).toBeUndefined();
  });

  it('level 1 会话执行 update 被 403 拒绝并写审计', async () => {
    const res = await PUT(
      buildPutRequest(
        {
          registryUrl: SAVED_CONFIG.registryUrl,
          namespace: 'public',
        },
        1,
      ),
    );
    expect(res.status).toBe(403);
    expect(mockSetNacosConfig).not.toHaveBeenCalled();
    expect(mockAppendAudit).toHaveBeenCalled();
  });

  it('无效 registryUrl 返回 400', async () => {
    const res = await PUT(
      buildPutRequest({ registryUrl: 'not-a-nacos-url', namespace: 'public' }, 3),
    );
    expect(res.status).toBe(400);
    expect(mockSetNacosConfig).not.toHaveBeenCalled();
  });
});
