import { describe, expect, it } from 'vitest';
import {
  BRIDGE_MODULE_KEY,
  BRIDGE_PLUGIN_ID,
  bridgeDirection,
  bridgeHasAction,
  bridgeInstallBody,
  bridgeInstallErrorText,
  bridgeInstalledVersion,
  bridgeModuleFromIndex,
  bridgeOptions,
  bridgeState,
  bridgeVersions,
  compareBridgeVersions,
  showQwenCodeBridge,
  type BridgeChannel,
} from './qwen-code-bridge';

/** 上游 channels.json 形态：versions 是对象 map，制品带 artifacts 数组。 */
function indexOf(channel: BridgeChannel, modules: Record<string, unknown>) {
  return {
    schema: 1,
    channel,
    modules,
    source: 'github',
    repo: 'LUOSENGWA/Millforge',
    fetched_at: '2026-11-08T01:30:00Z',
  };
}

function versionEntry(options: { zip?: string; sha?: string; deprecated?: boolean } = {}) {
  const { zip = 'qwenpaw-qwencode-bridge-0.3.0.zip', sha, deprecated = false } = options;
  return {
    // 故意把 tar.gz 放前面：安装只认 zip。
    artifacts: [
      { name: 'qwenpaw-qwencode-bridge-0.3.0.tar.gz', sha256: 'tar-sha' },
      ...(zip ? [{ name: zip, sha256: sha ?? `sha-${zip}` }] : []),
    ],
    requires: { qwenpaw: '>=2.2.0 <2.3.0' },
    deprecated,
  };
}

const STABLE = indexOf('stable', {
  [BRIDGE_MODULE_KEY]: {
    kind: 'plugin',
    pluginId: BRIDGE_PLUGIN_ID,
    latest: '0.3.0',
    versions: {
      '0.3.0': versionEntry(),
      '0.2.0': versionEntry({ zip: 'qwenpaw-qwencode-bridge-0.2.0.zip' }),
      '0.1.0': versionEntry({ zip: 'qwenpaw-qwencode-bridge-0.1.0.zip', deprecated: true }),
    },
  },
});

const ALPHA = indexOf('alpha', {
  [BRIDGE_MODULE_KEY]: {
    kind: 'plugin',
    pluginId: BRIDGE_PLUGIN_ID,
    latest: null,
    versions: {},
  },
});

describe('showQwenCodeBridge（显隐判据）', () => {
  it('只有 qwenpaw 运行时渲染桥栏', () => {
    expect(showQwenCodeBridge('qwenpaw')).toBe(true);
    for (const runtime of ['openclaw', 'copaw', 'hermes', 'openhuman', 'deepseek-harness']) {
      expect(showQwenCodeBridge(runtime)).toBe(false);
    }
    expect(showQwenCodeBridge(undefined)).toBe(false);
    expect(showQwenCodeBridge(null)).toBe(false);
  });
});

describe('compareBridgeVersions（semver 含预发布）', () => {
  it('按 semver 口径比较，预发布低于同号正式版', () => {
    expect(compareBridgeVersions('0.1.1-alpha.2', '0.1.0')).toBe(1);
    expect(compareBridgeVersions('0.1.1-alpha.2', '0.1.1')).toBe(-1);
    expect(compareBridgeVersions('0.1.0-alpha.10', '0.1.0-alpha.9')).toBe(1);
    expect(compareBridgeVersions('v0.3.0', '0.3.0')).toBe(0);
    expect(compareBridgeVersions('0.10.0', '0.9.9')).toBe(1);
  });
});

describe('bridgeModuleFromIndex（索引宽容解析）', () => {
  it('对象 map 形态：补 artifact/sha256 并去弃用、新版本在前', () => {
    const parsed = bridgeModuleFromIndex(STABLE);
    expect(parsed).not.toBeNull();
    expect(parsed?.latest).toBe('0.3.0');
    const versions = bridgeVersions(parsed);
    expect(versions.map((v) => v.version)).toEqual(['0.3.0', '0.2.0']);
    expect(versions[0]).toMatchObject({
      artifact: 'qwenpaw-qwencode-bridge-0.3.0.zip',
      sha256: 'sha-qwenpaw-qwencode-bridge-0.3.0.zip',
      deprecated: false,
    });
  });

  it('数组形态 versions 同样可解析', () => {
    const parsed = bridgeModuleFromIndex(
      indexOf('stable', {
        [BRIDGE_MODULE_KEY]: {
          latest: '0.4.0',
          versions: [{ version: '0.4.0', artifact: 'a.zip', sha256: 'sa' }],
        },
      }),
    );
    expect(bridgeVersions(parsed)).toEqual([
      { version: '0.4.0', artifact: 'a.zip', sha256: 'sa', deprecated: false },
    ]);
  });

  it('模块键缺失时按 pluginId 兜底匹配', () => {
    const parsed = bridgeModuleFromIndex(
      indexOf('stable', {
        'some-other-key': {
          pluginId: BRIDGE_PLUGIN_ID,
          latest: '0.5.0',
          versions: { '0.5.0': versionEntry({ zip: 'b.zip' }) },
        },
      }),
    );
    expect(parsed?.latest).toBe('0.5.0');
    expect(bridgeVersions(parsed)[0].artifact).toBe('b.zip');
  });

  it('索引缺失 / 无该模块 → null', () => {
    expect(bridgeModuleFromIndex(null)).toBeNull();
    expect(bridgeModuleFromIndex({})).toBeNull();
    expect(bridgeModuleFromIndex(indexOf('stable', { other: { latest: '1.0.0' } }))).toBeNull();
  });
});

describe('bridgeState（五态）', () => {
  const versions = bridgeVersions(bridgeModuleFromIndex(STABLE));

  it('未装 → not-installed，可安装', () => {
    const state = bridgeState({ installedVersion: null, versions, latest: '0.3.0' });
    expect(state).toBe('not-installed');
    expect(bridgeHasAction(state)).toBe(true);
    expect(bridgeDirection('0.3.0', null)).toBe('install');
  });

  it('索引最新高于已装 → update-available', () => {
    const state = bridgeState({ installedVersion: '0.2.0', versions, latest: '0.3.0' });
    expect(state).toBe('update-available');
    expect(bridgeHasAction(state)).toBe(true);
    expect(bridgeDirection('0.3.0', '0.2.0')).toBe('update');
  });

  it('索引最新等于已装 → up-to-date', () => {
    const state = bridgeState({ installedVersion: '0.3.0', versions, latest: '0.3.0' });
    expect(state).toBe('up-to-date');
    expect(bridgeHasAction(state)).toBe(false);
    expect(bridgeDirection('0.3.0', '0.3.0')).toBe('current');
  });

  it('已装高于索引最新 → ahead（该频道无更新）', () => {
    const state = bridgeState({ installedVersion: '0.4.0', versions, latest: '0.3.0' });
    expect(state).toBe('ahead');
    expect(bridgeHasAction(state)).toBe(false);
    expect(bridgeDirection('0.3.0', '0.4.0')).toBe('downgrade');
  });

  it('latest 为 null / 无可安装版本 → no-versions', () => {
    expect(bridgeState({ installedVersion: '0.3.0', versions: [], latest: null })).toBe(
      'no-versions',
    );
    expect(bridgeState({ installedVersion: null, versions: [], latest: '0.3.0' })).toBe(
      'no-versions',
    );
    expect(bridgeHasAction('no-versions')).toBe(false);
  });
});

describe('频道切换后的状态', () => {
  it('已装 0.3.0：stable 已是最新，alpha 该频道暂无版本', () => {
    const stable = bridgeVersions(bridgeModuleFromIndex(STABLE));
    const alpha = bridgeVersions(bridgeModuleFromIndex(ALPHA));
    expect(bridgeState({ installedVersion: '0.3.0', versions: stable, latest: '0.3.0' })).toBe(
      'up-to-date',
    );
    expect(bridgeState({ installedVersion: '0.3.0', versions: alpha, latest: null })).toBe(
      'no-versions',
    );
  });

  it('未装时切到 alpha 仍是 no-versions（不触发安装）', () => {
    const alpha = bridgeVersions(bridgeModuleFromIndex(ALPHA));
    expect(bridgeState({ installedVersion: null, versions: alpha, latest: null })).toBe(
      'no-versions',
    );
  });
});

describe('bridgeOptions（版本下拉）', () => {
  it('当前版本标记 current+disabled，缺制品标不可用，默认最新可安装', () => {
    const parsed = bridgeModuleFromIndex(
      indexOf('stable', {
        [BRIDGE_MODULE_KEY]: {
          latest: '0.3.0',
          versions: {
            '0.3.0': versionEntry(),
            '0.2.0': versionEntry({ zip: 'qwenpaw-qwencode-bridge-0.2.0.zip' }),
            '0.1.5': { artifacts: [] },
            '0.1.0': versionEntry({ zip: 'qwenpaw-qwencode-bridge-0.1.0.zip' }),
          },
        },
      }),
    );
    const options = bridgeOptions(bridgeVersions(parsed), '0.2.0');
    expect(options.map((o) => [o.version, o.current, o.disabled, o.defaultSelected])).toEqual([
      ['0.3.0', false, false, true],
      ['0.2.0', true, true, false],
      ['0.1.5', false, true, false],
      ['0.1.0', false, false, false],
    ]);
  });

  it('已装即最新：当前版本 current+disabled，低版本仍可选（显式降级）', () => {
    const parsed = bridgeModuleFromIndex(STABLE);
    const options = bridgeOptions(bridgeVersions(parsed), '0.3.0');
    expect(options[0]).toEqual({
      version: '0.3.0',
      current: true,
      disabled: true,
      defaultSelected: false,
    });
    expect(options[1]).toEqual({
      version: '0.2.0',
      current: false,
      disabled: false,
      defaultSelected: true,
    });
  });

  it('索引只有一个已装版本：无可安装选项（不出按钮）', () => {
    const parsed = bridgeModuleFromIndex(
      indexOf('stable', {
        [BRIDGE_MODULE_KEY]: { latest: '0.3.0', versions: { '0.3.0': versionEntry() } },
      }),
    );
    const options = bridgeOptions(bridgeVersions(parsed), '0.3.0');
    expect(options).toEqual([
      { version: '0.3.0', current: true, disabled: true, defaultSelected: false },
    ]);
    expect(options.some((o) => !o.disabled)).toBe(false);
  });

  it('未装：最新可安装为默认选中', () => {
    const options = bridgeOptions(bridgeVersions(bridgeModuleFromIndex(STABLE)), null);
    expect(options[0].defaultSelected).toBe(true);
    expect(options[0].version).toBe('0.3.0');
  });
});

describe('bridgeInstalledVersion（已装对账）', () => {
  it('按 plugin id 匹配，兼容 name 与模块键形态', () => {
    expect(bridgeInstalledVersion([{ id: BRIDGE_PLUGIN_ID, version: '0.3.0' }])).toBe('0.3.0');
    expect(bridgeInstalledVersion([{ name: BRIDGE_PLUGIN_ID, version: '0.2.0' }])).toBe('0.2.0');
    expect(bridgeInstalledVersion([{ id: BRIDGE_MODULE_KEY, version: '0.1.0' }])).toBe('0.1.0');
    expect(bridgeInstalledVersion([{ id: 'matrix-channel', version: '0.1.0' }])).toBeNull();
    expect(bridgeInstalledVersion([])).toBeNull();
    expect(bridgeInstalledVersion(null)).toBeNull();
  });
});

describe('bridgeInstallBody（安装 payload）', () => {
  it('module 用模块键、channel 为当前频道、带 artifact/sha256', () => {
    const versions = bridgeVersions(bridgeModuleFromIndex(STABLE));
    expect(bridgeInstallBody(versions[0], 'beta')).toEqual({
      module: BRIDGE_MODULE_KEY,
      source: 'github',
      repo: 'LUOSENGWA/Millforge',
      ref: 'main',
      channel: 'beta',
      version: '0.3.0',
      artifact: 'qwenpaw-qwencode-bridge-0.3.0.zip',
      sha256: 'sha-qwenpaw-qwencode-bridge-0.3.0.zip',
    });
  });
});

describe('bridgeInstallErrorText（状态码映射）', () => {
  it('409 sha 不一致 / 502 离线 / 404 版本不存在 / 400 不可安装 / 503 不支持', () => {
    expect(bridgeInstallErrorText(409)).toContain('sha256');
    expect(bridgeInstallErrorText(502)).toContain('离线');
    expect(bridgeInstallErrorText(404)).toContain('不存在');
    expect(bridgeInstallErrorText(400)).toContain('不可安装');
    expect(bridgeInstallErrorText(503)).toContain('不支持');
    expect(bridgeInstallErrorText(500, 'boom')).toContain('boom');
    expect(bridgeInstallErrorText(500, 'boom')).toContain('安装失败');
  });
});
