import { beforeEach, describe, expect, it, vi } from 'vitest';
import { agentteamsApi, type ManagerResponse } from './agentteams-api';
import { matrixApi } from './matrix-api';
import { useMatrixStore } from './matrix-store';
import { deployDevelopmentSquad, developmentSquadPrompt } from './development-squad';

vi.mock('./agentteams-api', () => ({ agentteamsApi: { listManagers: vi.fn(), createWorker: vi.fn(), createTeam: vi.fn(), createSkill: vi.fn() } }));
vi.mock('./matrix-api', () => ({ matrixApi: { getJoinedRooms: vi.fn(), sendMessage: vi.fn() } }));
vi.mock('./matrix-store', () => ({ useMatrixStore: { getState: vi.fn() } }));
const request = { name: 'dev-team', repository: 'owner/demo', requestId: 'request-1' };
beforeEach(() => {
  vi.resetAllMocks();
  vi.mocked(useMatrixStore.getState).mockReturnValue({ isLoggedIn: true, homeserver: 'https://matrix.test', accessToken: 'test-only' } as ReturnType<typeof useMatrixStore.getState>);
  vi.mocked(agentteamsApi.listManagers).mockResolvedValue([{ name: 'default', phase: 'Running', roomID: '!manager:test', matrixUserID: '@manager:test' }] as ManagerResponse[]);
  vi.mocked(matrixApi.getJoinedRooms).mockResolvedValue({ joined_rooms: ['!manager:test'] });
  vi.mocked(matrixApi.sendMessage).mockResolvedValue({ event_id: '$request' });
});
describe('Manager-owned development squad provisioning', () => {
  it('sends one mentioned request to the default Manager and never provisions resources in the Dashboard', async () => {
    expect(await deployDevelopmentSquad(request)).toEqual({ teamName: 'dev-team', managerName: 'default', roomId: '!manager:test', eventId: '$request' });
    expect(matrixApi.sendMessage).toHaveBeenCalledWith('https://matrix.test', 'test-only', '!manager:test', expect.stringContaining('Codex runtime（codex）'), { mentions: { user_ids: ['@manager:test'] } });
    expect(agentteamsApi.createWorker).not.toHaveBeenCalled();
    expect(agentteamsApi.createTeam).not.toHaveBeenCalled();
    expect(agentteamsApi.createSkill).not.toHaveBeenCalled();
  });
  it('states default model inheritance and confirmation before creating an Issue Task', () => {
    const prompt = developmentSquadPrompt(request);
    expect(prompt).toContain('当前集群默认模型');
    expect(prompt).toContain('未确认时不得创建 Task');
    expect(prompt).toContain('稳定 ID 的主 Task');
    expect(prompt).toContain('request-1');
    expect(prompt).toContain('https://github.com/owner/demo');
    expect(prompt).toContain('https://agentteams.cloud/skills/development-squad/manifest.json');
    expect(prompt).toContain('不依赖额外安装名为 development-squad 的 Skill');
    expect(prompt).toContain('四个角色均可访问负责仓库');
  });
  it('preserves an explicit model and requires verification without silently changing it', () => {
    const prompt = developmentSquadPrompt({ ...request, model: 'qwen3.8-plus' });
    expect(prompt).toContain('统一指定模型：qwen3.8-plus');
    expect(prompt).toContain('不要换模型');
  });
  it('rejects invalid names, repositories or model text before sending', async () => {
    await expect(deployDevelopmentSquad({ ...request, repository: 'https://evil.test/repo' })).rejects.toThrow('owner/repository');
    await expect(deployDevelopmentSquad({ ...request, name: '../other' })).rejects.toThrow('1–10');
    await expect(deployDevelopmentSquad({ ...request, model: 'model\nother instructions' })).rejects.toThrow('模型名称');
    expect(matrixApi.sendMessage).not.toHaveBeenCalled();
  });
  it('does not send without a Matrix identity or membership in the Manager room', async () => {
    vi.mocked(useMatrixStore.getState).mockReturnValue({ isLoggedIn: false } as ReturnType<typeof useMatrixStore.getState>);
    await expect(deployDevelopmentSquad(request)).rejects.toThrow('连接对话');
    vi.mocked(useMatrixStore.getState).mockReturnValue({ isLoggedIn: true, homeserver: 'hs', accessToken: 'test-only' } as ReturnType<typeof useMatrixStore.getState>);
    vi.mocked(matrixApi.getJoinedRooms).mockResolvedValue({ joined_rooms: [] });
    await expect(deployDevelopmentSquad(request)).rejects.toThrow('尚未加入');
    expect(matrixApi.sendMessage).not.toHaveBeenCalled();
  });
  it('does not fall back to another Manager or report success on delivery failure', async () => {
    vi.mocked(agentteamsApi.listManagers).mockResolvedValue([{ name: 'other', phase: 'Running' }] as ManagerResponse[]);
    await expect(deployDevelopmentSquad(request)).rejects.toThrow('默认 Manager');
    vi.mocked(agentteamsApi.listManagers).mockResolvedValue([{ name: 'default', phase: 'Running', roomID: '!manager:test', matrixUserID: '@manager:test' }] as ManagerResponse[]);
    vi.mocked(matrixApi.sendMessage).mockRejectedValue(new Error('delivery unknown'));
    await expect(deployDevelopmentSquad(request)).rejects.toThrow('delivery unknown');
    expect(matrixApi.sendMessage).toHaveBeenCalledOnce();
  });
});
