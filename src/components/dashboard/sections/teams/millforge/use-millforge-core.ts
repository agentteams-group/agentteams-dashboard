'use client';

// 千锻（Millforge）弹窗共享状态——四 tab（注入 / 自定义团队 / 模块更新 /
// 注入历史）各持同一实例：源配置 → 导入 pack → 模板 spec → 编译预览 →
// 注入 → LLM 二次生成 → 注入历史。契约对齐工作台插件 useMillforgeCore
// （agentteams_connector/millforge_api.py），仪表盘侧只做 UI 适配。

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  agentteamsApi,
  type MillforgeBuildResult,
  type MillforgeInjectionRec,
  type MillforgeInjectRequest,
  type MillforgeInjectResult,
  type MillforgePack,
  type MillforgePackIndex,
  type MillforgeParseResult,
  type MillforgePreflightTarget,
  type MillforgeSource,
  type MillforgeTemplateSpec,
  type TeamResponse,
  type WorkerResponse,
} from '@/lib/agentteams-api';
import { ApiError } from '@/lib/api-error';

/** 源 Segmented 三态（custom = custom_url 非空，kind 保持最后真实值）。 */
export type MillforgeSourceSeg = 'github' | 'gitcode' | 'custom';

/** 注入模式：mapping = 更新已选 Worker / create = 新建 Worker 并注入。 */
export type MillforgeInjectMode = 'mapping' | 'create';

/** create 模式行（role_id 随 build 角色固定；name/role/model 可编辑）。 */
export interface MillforgeCreateRow {
  key: string;
  role_id: string;
  name: string;
  role: 'team_leader' | 'worker';
  model: string;
}

/** 自定义团队（描述需求）表单 + 提示词 + LLM JSON 校验状态。 */
export interface MillforgeCustomState {
  members: string;
  task_types: string;
  runtime: string;
  pains: string;
  team_name: string;
  prompt: string;
  promptBusy: boolean;
  promptError: string;
  jsonText: string;
  parseBusy: boolean;
  parseError: string;
  parseResult: MillforgeParseResult | null;
}

const EMPTY_CUSTOM: MillforgeCustomState = {
  members: '',
  task_types: '',
  runtime: '',
  pains: '',
  team_name: '',
  prompt: '',
  promptBusy: false,
  promptError: '',
  jsonText: '',
  parseBusy: false,
  parseError: '',
  parseResult: null,
};

const EMPTY_SPEC: MillforgeTemplateSpec = {
  industry: '',
  domains: [],
  members: { leader: 1, workers: 2, critic: 0 },
};

/**
 * 千锻端点错误文案：旧 Controller 没有这些路由（404/405）时诚实降级为
 * 「控制器不支持」，其余原样保留上游错误体（不吞细节）。
 */
export function millforgeErrorText(error: unknown): string {
  if (error instanceof ApiError && (error.status === 404 || error.status === 405)) {
    return '控制器不支持该千锻端点（404/405）——需升级 Controller 后可用';
  }
  return error instanceof Error ? error.message : String(error);
}

const errText = millforgeErrorText;

/**
 * 编译错误美化：ApiError 消息形如 `API Error 422: {…json…}`（proxyRequest
 * 拼装），422 detail 是编译器失败对象（stage/error/stderr_tail）→ 分段可读。
 */
export function formatCompileError(error: unknown): string {
  const raw = errText(error);
  const match = /^(?:API Error|HTTP) \d{3}:\s*([\s\S]*)$/.exec(raw);
  const body = (match ? match[1] : raw).trim();
  if (body.startsWith('{')) {
    try {
      const detail = JSON.parse(body) as Record<string, unknown>;
      const stage = String(detail.stage || '');
      const message = String(detail.error || detail.detail || '');
      const tail = String(detail.stderr_tail || '').trim();
      let out = `编译失败${stage ? `（${stage}）` : ''}${message ? `：${message}` : ''}`;
      if (tail) out += `\n${tail.slice(-600)}`;
      return out;
    } catch {
      /* 非 JSON——原样返回 */
    }
  }
  return raw;
}

export type MillforgeCompileOutcome = {
  build: MillforgeBuildResult | null;
  error: string;
};

/** doInject 的函数签名（ref 用于覆盖确认后二次调用）。 */
type MillforgeDoInject = (
  _targetTeam: string,
  _overwrite?: boolean,
) => Promise<MillforgeInjectResult | null>;

interface TeamMember {
  name: string;
  role: string;
}

/** 团队成员（团队 CR 的 leaderName + workerNames；角色取 Worker 投影）。 */
function teamMembers(team: TeamResponse, workers: WorkerResponse[]): TeamMember[] {
  const byName = new Map(workers.map((worker) => [worker.name, worker] as const));
  const names = (team.workerNames ?? []).filter((name) => !team.leaderName || name !== team.leaderName);
  const members: TeamMember[] = [];
  if (team.leaderName) {
    members.push({
      name: team.leaderName,
      role: byName.get(team.leaderName)?.role || 'team_leader',
    });
  }
  for (const name of names) {
    members.push({ name, role: byName.get(name)?.role || 'worker' });
  }
  return members;
}

/** 按角色预填 mapping：leader 角色 → team_leader 成员，其余 → worker 成员（按序）。 */
export function buildMapping(
  roles: { role: string; kind: string }[],
  members: TeamMember[],
): Record<string, string> {
  const leaders = members.filter((member) => member.role === 'team_leader');
  const others = members.filter((member) => member.role !== 'team_leader');
  let leaderIndex = 0;
  let workerIndex = 0;
  const mapping: Record<string, string> = {};
  for (const role of roles) {
    if (role.kind === 'leader') {
      const member = leaders[leaderIndex];
      if (member) mapping[role.role] = member.name;
      leaderIndex += 1;
    } else {
      const member = others[workerIndex];
      if (member) mapping[role.role] = member.name;
      workerIndex += 1;
    }
  }
  return mapping;
}

interface UseMillforgeCoreOptions {
  team: TeamResponse;
  workers: WorkerResponse[];
  /** 注入完成（含部分失败——读回状态已落）后刷新团队抽屉数据。 */
  onInjected?: () => void;
}

export function useMillforgeCore({ team, workers, onInjected }: UseMillforgeCoreOptions) {
  const teamName = team.name;

  // ── 源配置（Segmented 切换即 PUT 持久化；文本输入失焦持久化）──
  const [source, setSource] = useState<MillforgeSource | null>(null);
  const [sourceError, setSourceError] = useState('');
  const [ref, setRef] = useState('main');
  const [importing, setImporting] = useState(false);
  const [importMsg, setImportMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const loadSource = useCallback(async () => {
    setSourceError('');
    try {
      setSource(await agentteamsApi.getMillforgeSource());
    } catch (error) {
      setSourceError(errText(error));
    }
  }, []);
  useEffect(() => {
    void loadSource();
  }, [loadSource]);

  // Segmented 的「用户意图」：custom 只在本地状态生效（custom_url 为空也能停住），
  // 持久化成功后回到派生值。
  const [segIntent, setSegIntent] = useState<MillforgeSourceSeg | null>(null);

  const persistSource = useCallback(
    async (patch: { kind?: string; repo?: string; custom_url?: string }) => {
      setSourceError('');
      try {
        setSource(await agentteamsApi.putMillforgeSource(patch));
        setSegIntent(null);
      } catch (error) {
        setSourceError(errText(error));
      }
    },
    [],
  );

  const seg: MillforgeSourceSeg = segIntent
    ?? (source ? (source.custom_url ? 'custom' : source.kind === 'gitcode' ? 'gitcode' : 'github') : 'github');

  const changeSeg = useCallback(
    (next: MillforgeSourceSeg) => {
      if (!source) return;
      if (next === 'custom') {
        // 只切本地意图：custom_url 为空也能停在「自定义」并显示 URL 输入。
        setSegIntent('custom');
        return;
      }
      void persistSource({ kind: next, custom_url: '' });
    },
    [source, persistSource],
  );

  const persistRepo = useCallback(
    (repo: string) => {
      if (!source) return;
      void persistSource({ kind: source.kind, repo, custom_url: '' });
    },
    [source, persistSource],
  );

  const persistCustomUrl = useCallback(
    (url: string) => {
      if (!source) return;
      // 空串 = 清空自定义（回到 kind+repo 派生）——带 kind 防 400（repo 现值兜底）。
      void persistSource({ kind: source.kind, repo: source.repo, custom_url: url });
    },
    [source, persistSource],
  );

  // ── 导入 / pack 列表 ──
  const [packs, setPacks] = useState<MillforgePack[]>([]);
  const [packsLoading, setPacksLoading] = useState(true);
  const [packsError, setPacksError] = useState('');
  const [pack, setPack] = useState('');

  const loadPacks = useCallback(async () => {
    setPacksLoading(true);
    setPacksError('');
    try {
      const data = await agentteamsApi.getMillforgePacks();
      setPacks(data.packs ?? []);
    } catch (error) {
      setPacksError(errText(error));
    } finally {
      setPacksLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadPacks();
  }, [loadPacks]);

  // 无选中（或选中已删）→ 自动选首个（优先 INDEX 可解析的）。
  useEffect(() => {
    setPack((current) => {
      if (packs.length === 0) return '';
      if (packs.some((candidate) => candidate.pack === current)) return current;
      return (packs.find((candidate) => candidate.index && !candidate.parse_error) || packs[0]).pack;
    });
  }, [packs]);

  const activePack: MillforgePack | null = packs.find((candidate) => candidate.pack === pack) ?? null;
  const index: MillforgePackIndex | null = activePack?.index ?? null;

  const doImport = useCallback(async (): Promise<boolean> => {
    setImporting(true);
    setImportMsg(null);
    setSourceError('');
    try {
      const data = await agentteamsApi.importMillforgePack(ref.trim() || 'main');
      setImportMsg({
        ok: true,
        text: `导入成功：${data.pack}（${data.files} 个文件，commit ${String(data.commit || '').slice(0, 7)}${data.has_compiler ? '' : '，未含编译器'}）`,
      });
      await loadPacks();
      setPack(data.pack);
      return true;
    } catch (error) {
      const text = errText(error);
      setImportMsg({ ok: false, text });
      setSourceError(text);
      return false;
    } finally {
      setImporting(false);
    }
  }, [ref, loadPacks]);

  // ── 模板 spec（industry 单选 + domains 多选 + 整队组合 + members + lang）──
  const [spec, setSpec] = useState<MillforgeTemplateSpec>(EMPTY_SPEC);
  const [lang, setLang] = useState<'zh' | 'en'>('zh');
  const [comboWarning, setComboWarning] = useState('');

  const pickCombo = useCallback(
    (comboId: string) => {
      const combo = index?.teams.find((candidate) => candidate.id === comboId) || null;
      if (!combo) {
        setComboWarning('');
        setSpec((previous) => ({ ...previous, team_combo: '' }));
        return;
      }
      const num = (value: string, fallback: number) => {
        const parsed = Number.parseInt(String(value).replace(/\D/g, ''), 10);
        return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
      };
      // 级联：组合的 domains 须属于（组合自带/当前所选）industry；
      // INDEX 无 industry 字段（旧包）时跳过校验——诚实降级。
      const nextIndustry = combo.industry || spec.industry || '';
      let domains = combo.domains
        ? combo.domains.split(',').map((entry) => entry.trim()).filter(Boolean)
        : spec.domains || [];
      let warning = '';
      const domainEntries = (index?.domain ?? []).filter((entry) => entry.id);
      const hasIndustryInfo = domainEntries.some((entry) => entry.industry);
      if (nextIndustry && hasIndustryInfo && domains.length) {
        const belonging = new Set(
          domainEntries.filter((entry) => entry.industry === nextIndustry).map((entry) => entry.id),
        );
        if (!domains.every((domain) => belonging.has(domain))) {
          domains = [];
          warning = '整队组合的领域不属于所选行业——已清空 domains（可手动补选）';
        }
      }
      setComboWarning(warning);
      setSpec({
        team_combo: combo.id,
        industry: nextIndustry,
        domains,
        members: {
          leader: num(combo.members.leader, spec.members?.leader || 1),
          workers: num(combo.members.workers, spec.members?.workers || 2),
          critic: num(combo.members.critic, spec.members?.critic || 0),
        },
      });
    },
    [index, spec],
  );

  // ── 编译预览 ──
  const [build, setBuild] = useState<MillforgeBuildResult | null>(null);
  const [compiling, setCompiling] = useState(false);
  const [compileError, setCompileError] = useState('');

  const compileWithTemplate = useCallback(
    async (targetTeam: string): Promise<MillforgeCompileOutcome> => {
      if (!pack) return { build: null, error: '尚未导入模板包——先选择源并导入' };
      setCompiling(true);
      setCompileError('');
      try {
        const result = await agentteamsApi.compileMillforge({
          pack,
          team: targetTeam,
          lang,
          template: {
            team_combo: spec.team_combo || undefined,
            industry: spec.industry || undefined,
            domains: spec.domains || [],
            members: spec.members || EMPTY_SPEC.members,
          },
        });
        setBuild(result);
        return { build: result, error: '' };
      } catch (error) {
        const message = formatCompileError(error);
        setBuild(null);
        setCompileError(message);
        return { build: null, error: message };
      } finally {
        setCompiling(false);
      }
    },
    [pack, lang, spec],
  );

  const compileWithTeamJson = useCallback(
    async (targetTeam: string, teamJson: Record<string, unknown>): Promise<MillforgeCompileOutcome> => {
      if (!pack) return { build: null, error: '尚未导入模板包——先选择源并导入' };
      setCompiling(true);
      setCompileError('');
      try {
        const result = await agentteamsApi.compileMillforge({
          pack,
          team: targetTeam,
          lang,
          team_json: teamJson,
        });
        setBuild(result);
        return { build: result, error: '' };
      } catch (error) {
        const message = formatCompileError(error);
        setBuild(null);
        setCompileError(message);
        return { build: null, error: message };
      } finally {
        setCompiling(false);
      }
    },
    [pack, lang],
  );

  // ── 注入（mapping / create；逐项结果 + partial）──
  const [injectMode, setInjectMode] = useState<MillforgeInjectMode>('mapping');
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [createRows, setCreateRows] = useState<MillforgeCreateRow[]>([]);
  const [applySoul, setApplySoul] = useState(true);
  const [injecting, setInjecting] = useState(false);
  const [injectError, setInjectError] = useState('');
  const [injectResult, setInjectResult] = useState<MillforgeInjectResult | null>(null);
  const [soulConflicts, setSoulConflicts] = useState<MillforgePreflightTarget[] | null>(null);
  const [pendingInjectTeam, setPendingInjectTeam] = useState('');

  const membersRef = useRef<TeamMember[]>([]);
  membersRef.current = teamMembers(team, workers);

  // 新 build 产出 → 按角色初始化 mapping（按团队现有成员预填）/ createRows（名留空）。
  useEffect(() => {
    if (!build) {
      setMapping({});
      setCreateRows([]);
      return;
    }
    setMapping(buildMapping(build.roles, membersRef.current));
    setCreateRows(
      build.roles.map((role) => ({
        key: role.role,
        role_id: role.role,
        name: '',
        role: role.kind === 'leader' ? 'team_leader' : 'worker',
        model: '',
      })),
    );
    setInjectResult(null);
    setInjectError('');
  }, [build]);

  const lastInjectedRef = useRef<MillforgeInjectResult | null>(null);
  useEffect(() => {
    if (injectResult && injectResult !== lastInjectedRef.current) {
      lastInjectedRef.current = injectResult;
      onInjected?.();
    }
  }, [injectResult, onInjected]);

  const doInjectRef = useRef<MillforgeDoInject | null>(null);

  const confirmSoulOverwrite = useCallback(async () => {
    const targetTeam = pendingInjectTeam;
    setSoulConflicts(null);
    if (targetTeam) await doInjectRef.current?.(targetTeam, true);
  }, [pendingInjectTeam]);

  const cancelSoulOverwrite = useCallback(() => {
    setSoulConflicts(null);
    setPendingInjectTeam('');
  }, []);

  const rollbackSoul = useCallback(async (worker: string): Promise<boolean> => {
    try {
      const result = await agentteamsApi.rollbackMillforgeSoul(worker);
      return Boolean(result?.verified);
    } catch (error) {
      setInjectError(errText(error));
      return false;
    }
  }, []);

  const doInject = useCallback(
    async (targetTeam: string, overwrite = false): Promise<MillforgeInjectResult | null> => {
      if (!build) return null;
      const coreSkill = false; // AgentTeams 1.2.6 起 core 已集成在 TeamHarness，只注入 SOUL
      if (injectMode === 'mapping') {
        const selected: Record<string, string> = {};
        for (const [roleId, worker] of Object.entries(mapping)) {
          const trimmed = (worker || '').trim();
          if (trimmed) selected[roleId] = trimmed;
        }
        if (Object.keys(selected).length === 0) {
          setInjectError('至少选择 1 个现有 Worker（mapping）');
          return null;
        }
        // 预检：现有 SOUL 与 build 不同时先让用户确认（不静默覆盖）。
        if (!overwrite) {
          try {
            const preflight = await agentteamsApi.preflightMillforgeSouls(build.build_id, selected);
            if ((preflight.conflict_count || 0) > 0) {
              setSoulConflicts((preflight.targets || []).filter((target) => target.state === 'differs'));
              setPendingInjectTeam(targetTeam);
              return null;
            }
          } catch {
            /* 预检失败不阻断：注入侧仍有 409 兜底 */
          }
        }
        setInjecting(true);
        setInjectError('');
        try {
          const request: MillforgeInjectRequest = {
            build_id: build.build_id,
            team: targetTeam,
            mapping: selected,
            create_workers: [],
            core_skill: coreSkill,
            apply_soul: applySoul,
            overwrite,
          };
          const result = await agentteamsApi.injectMillforge(request);
          setInjectResult(result);
          setSoulConflicts(null);
          return result;
        } catch (error) {
          setInjectError(errText(error));
          return null;
        } finally {
          setInjecting(false);
        }
      }
      const rows = createRows.filter((row) => (row.name || '').trim());
      if (rows.length === 0) {
        setInjectError('请填写至少 1 个新建 Worker 名（create_workers）');
        return null;
      }
      const invalid = rows.filter((row) => !/^[a-z0-9][a-z0-9-]{0,63}$/.test(row.name.trim()));
      if (invalid.length > 0) {
        setInjectError(
          `Worker 名须小写字母/数字/-（≤64 字符）：${invalid.map((row) => row.name.trim()).join('、')}`,
        );
        return null;
      }
      setInjecting(true);
      setInjectError('');
      try {
        const result = await agentteamsApi.injectMillforge({
          build_id: build.build_id,
          team: targetTeam,
          mapping: {},
          create_workers: rows.map((row) => ({
            name: row.name.trim(),
            role_id: row.role_id,
            role: row.role,
            model: (row.model || '').trim() || undefined,
            runtime: 'qwenpaw',
          })),
          core_skill: coreSkill,
          apply_soul: applySoul,
          overwrite,
        });
        setInjectResult(result);
        return result;
      } catch (error) {
        setInjectError(errText(error));
        return null;
      } finally {
        setInjecting(false);
      }
    },
    [build, injectMode, mapping, createRows, applySoul],
  );
  doInjectRef.current = doInject;

  // ── 自定义团队（描述需求 → 提示词 → LLM JSON 校验）──
  const [custom, setCustom] = useState<MillforgeCustomState>(EMPTY_CUSTOM);

  const genPrompt = useCallback(async () => {
    if (!pack) {
      setCustom((state) => ({ ...state, promptError: '尚未导入模板包——先选择源并导入' }));
      return;
    }
    setCustom((state) => ({ ...state, promptBusy: true, promptError: '' }));
    try {
      const result = await agentteamsApi.promptMillforge(pack, {
        members: custom.members,
        task_types: custom.task_types,
        runtime: custom.runtime,
        pains: custom.pains,
        team_name: custom.team_name,
      });
      setCustom((state) => ({ ...state, prompt: result.prompt }));
    } catch (error) {
      setCustom((state) => ({ ...state, promptError: errText(error) }));
    } finally {
      setCustom((state) => ({ ...state, promptBusy: false }));
    }
  }, [pack, custom.members, custom.task_types, custom.runtime, custom.pains, custom.team_name]);

  const parseJson = useCallback(async () => {
    if (!pack) {
      setCustom((state) => ({ ...state, parseError: '尚未导入模板包——先选择源并导入' }));
      return;
    }
    if (!(custom.jsonText || '').trim()) {
      setCustom((state) => ({ ...state, parseError: '先粘贴 LLM 返回的 JSON 文本' }));
      return;
    }
    setCustom((state) => ({ ...state, parseBusy: true, parseError: '', parseResult: null }));
    try {
      const result = await agentteamsApi.parseMillforgeTeamJson(pack, custom.jsonText);
      setCustom((state) => ({ ...state, parseResult: result }));
    } catch (error) {
      setCustom((state) => ({ ...state, parseError: errText(error) }));
    } finally {
      setCustom((state) => ({ ...state, parseBusy: false }));
    }
  }, [pack, custom.jsonText]);

  // ── 注入历史（GET /millforge/injections，留 50）──
  const [injections, setInjections] = useState<MillforgeInjectionRec[]>([]);
  const [injLoading, setInjLoading] = useState(false);
  const [injError, setInjError] = useState('');

  const loadInjections = useCallback(async () => {
    setInjLoading(true);
    setInjError('');
    try {
      const data = await agentteamsApi.getMillforgeInjections();
      setInjections(data.injections ?? []);
    } catch (error) {
      setInjections([]);
      setInjError(errText(error));
    } finally {
      setInjLoading(false);
    }
  }, []);
  useEffect(() => {
    void loadInjections();
  }, [loadInjections]);

  return {
    teamName,
    // 源
    source,
    sourceError,
    seg,
    changeSeg,
    persistRepo,
    persistCustomUrl,
    ref,
    setRef,
    importing,
    importMsg,
    doImport,
    loadSource,
    // pack
    packs,
    packsLoading,
    packsError,
    loadPacks,
    pack,
    setPack,
    activePack,
    index,
    // spec
    spec,
    setSpec,
    pickCombo,
    comboWarning,
    setComboWarning,
    lang,
    setLang,
    // 编译
    build,
    compiling,
    compileError,
    compileWithTemplate,
    compileWithTeamJson,
    // 注入
    injectMode,
    setInjectMode,
    mapping,
    setMapping,
    createRows,
    setCreateRows,
    applySoul,
    setApplySoul,
    injecting,
    injectError,
    injectResult,
    doInject,
    soulConflicts,
    confirmSoulOverwrite,
    cancelSoulOverwrite,
    rollbackSoul,
    // 自定义
    custom,
    setCustom,
    genPrompt,
    parseJson,
    // 历史
    injections,
    injLoading,
    injError,
    loadInjections,
  };
}

export type MillforgeCore = ReturnType<typeof useMillforgeCore>;
export type { TeamMember };
