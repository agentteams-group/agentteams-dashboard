// QwenPaw legacy `memory/running-config` model helpers.
//
// Ported 1:1 from the workbench plugin `components/WorkerRuntimeConfigCore.tsx`
// (diff builder + loop gate merge) so the dashboard panel keeps the same write
// contract: PUT only the top-level keys the user changed, merge nested objects
// read-merge-write, and mirror the iteration gate onto the legacy `max_iters`
// value (QwenPaw console semantics — `loop.iteration.max_iterations` wins, and
// the legacy key must follow or old workers silently keep the old limit).
//
// No field is invented here: every key exists in qwenpaw AgentsRunningConfig
// (verified against SC/QwenPaw/src/qwenpaw/config/config.py).

export type Rc = Record<string, unknown>;

export type EditValue = string | boolean;
export type EditMap = Record<string, EditValue>;

export interface LoopGates {
  iterationEnabled: boolean;
  iterationMax: number | null;
  doomEnabled: boolean;
  doomWindow: number | null;
  doomThreshold: number | null;
  doomStages: DoomStageDraft[];
  rubricEnabled: boolean;
  rubricPrompt: string;
  rubricInterventions: number | null;
  goalMaxIters: number | null;
  goalMaxTokens: number | null;
  missionMaxIters: number | null;
  missionMaxRetries: number | null;
  missionVerifyInstructions: string;
  missionVerifyCommand: string;
}

export interface DoomStageDraft {
  after: string;
  action: 'modify_prompt' | 'stop';
  prompt: string;
}

export function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null;
}

export function isPosInt(s: string): boolean {
  return /^\d+$/.test(s.trim()) && Number(s.trim()) > 0;
}

export function isPosNum(s: string): boolean {
  const n = Number(s.trim());
  return s.trim() !== '' && Number.isFinite(n) && n > 0;
}

function asObject(v: unknown): Rc {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Rc) : {};
}

function cloneObject(v: unknown): Rc {
  return JSON.parse(JSON.stringify(asObject(v))) as Rc;
}

export function parseLoopGates(v: unknown): LoopGates {
  const o = asObject(v);
  const it = asObject(o.iteration);
  const doom = asObject(o.doom_loop);
  const rub = asObject(o.rubric);
  const goal = asObject(o.goal);
  const mis = asObject(o.mission);
  const stagesRaw = Array.isArray(doom.stages) ? doom.stages : [];
  return {
    iterationEnabled: it.enabled === true,
    iterationMax: num(it.max_iterations),
    doomEnabled: doom.enabled === true,
    doomWindow: num(doom.window_size),
    doomThreshold: num(doom.similarity_threshold),
    doomStages: stagesRaw
      .filter((s): s is Rc => Boolean(s) && typeof s === 'object')
      .map((s) => ({
        after: s.after === null || s.after === undefined ? '' : String(s.after),
        action: s.action === 'stop' ? 'stop' : 'modify_prompt',
        prompt: typeof s.prompt === 'string' ? s.prompt : '',
      })),
    rubricEnabled: rub.enabled === true,
    rubricPrompt: typeof rub.prompt === 'string' ? rub.prompt : '',
    rubricInterventions: num(rub.max_interventions),
    goalMaxIters: num(goal.max_iterations),
    goalMaxTokens: num(goal.max_tokens),
    missionMaxIters: num(mis.max_iterations),
    missionMaxRetries: num(mis.max_retries_per_story),
    missionVerifyInstructions:
      typeof mis.default_verification_instructions === 'string'
        ? mis.default_verification_instructions
        : '',
    missionVerifyCommand:
      typeof mis.default_verify_command === 'string' ? mis.default_verify_command : '',
  };
}

function checkInt(s: string, lo: number, hi: number): number | null {
  const t = s.trim();
  if (!/^\d+$/.test(t)) return null;
  const n = Number(t);
  return n >= lo && n <= hi ? n : null;
}

/**
 * Merge the gate edits onto the current loop object. PUT `loop` is a whole
 * object replacement, so the merged object must carry every untouched gate.
 */
export function buildLoopPatch(
  base: unknown,
  edits: EditMap,
  stages: DoomStageDraft[] | null,
): { loop: Rc; changed: boolean; invalid: string } {
  const merged = cloneObject(base);
  let changed = false;
  const sub = (k: string): Rc => {
    if (!merged[k] || typeof merged[k] !== 'object') merged[k] = {};
    return merged[k] as Rc;
  };

  const it = sub('iteration');
  if (edits.iteration_enabled !== undefined) {
    it.enabled = edits.iteration_enabled === true;
    changed = true;
  }
  if (edits.iteration_max !== undefined) {
    const n = checkInt(String(edits.iteration_max), 1, 500);
    if (n === null) return { loop: merged, changed, invalid: '迭代上限须为 1..500 的整数' };
    if (n !== num(it.max_iterations)) {
      it.max_iterations = n;
      changed = true;
    }
  }

  const dl = sub('doom_loop');
  if (edits.doom_enabled !== undefined) {
    dl.enabled = edits.doom_enabled === true;
    changed = true;
  }
  if (edits.doom_window !== undefined) {
    const n = checkInt(String(edits.doom_window), 2, 100);
    if (n === null) return { loop: merged, changed, invalid: '重复检测窗口须为 ≥2 的整数' };
    if (n !== num(dl.window_size)) {
      dl.window_size = n;
      changed = true;
    }
  }
  if (edits.doom_threshold !== undefined) {
    const s = String(edits.doom_threshold).trim();
    const n = Number(s);
    if (s === '' || !Number.isFinite(n) || n < 0 || n > 1) {
      return { loop: merged, changed, invalid: '相似度阈值须为 0..1 的数' };
    }
    if (n !== num(dl.similarity_threshold)) {
      dl.similarity_threshold = n;
      changed = true;
    }
  }
  if (stages !== null) {
    const arr: Array<{ after: number; action: string; prompt: string }> = [];
    for (const st of stages) {
      const n = checkInt(st.after, 1, Number.MAX_SAFE_INTEGER);
      if (n === null) return { loop: merged, changed, invalid: '重复规则：重复次数须为 ≥1 的整数' };
      arr.push({ after: n, action: st.action, prompt: st.prompt });
    }
    if (JSON.stringify(arr) !== JSON.stringify(dl.stages ?? [])) {
      dl.stages = arr;
      changed = true;
    }
  }

  const rb = sub('rubric');
  if (edits.rubric_enabled !== undefined) {
    rb.enabled = edits.rubric_enabled === true;
    changed = true;
  }
  if (edits.rubric_prompt !== undefined) {
    const v = String(edits.rubric_prompt);
    if (v.length > 4000) return { loop: merged, changed, invalid: 'Rubric 提示词过长（上限 4000 字）' };
    if (v !== String(rb.prompt ?? '')) {
      rb.prompt = v;
      changed = true;
    }
  }
  if (edits.rubric_interventions !== undefined) {
    const n = checkInt(String(edits.rubric_interventions), 1, 10);
    if (n === null) return { loop: merged, changed, invalid: 'Rubric 最大干预次数须为 1..10 的整数' };
    if (n !== num(rb.max_interventions)) {
      rb.max_interventions = n;
      changed = true;
    }
  }

  const gl = sub('goal');
  if (edits.goal_max_iterations !== undefined) {
    const n = checkInt(String(edits.goal_max_iterations), 1, 500);
    if (n === null) return { loop: merged, changed, invalid: 'Goal 最大迭代须为 1..500 的整数' };
    if (n !== num(gl.max_iterations)) {
      gl.max_iterations = n;
      changed = true;
    }
  }
  if (edits.goal_max_tokens !== undefined) {
    const n = checkInt(String(edits.goal_max_tokens), 1, 10000000);
    if (n === null) return { loop: merged, changed, invalid: 'Goal 词元预算须为正整数' };
    if (n !== num(gl.max_tokens)) {
      gl.max_tokens = n;
      changed = true;
    }
  }

  const ms = sub('mission');
  if (edits.mission_max_iterations !== undefined) {
    const n = checkInt(String(edits.mission_max_iterations), 1, 100);
    if (n === null) return { loop: merged, changed, invalid: 'Mission 最大迭代须为 1..100 的整数' };
    if (n !== num(ms.max_iterations)) {
      ms.max_iterations = n;
      changed = true;
    }
  }
  if (edits.mission_max_retries_per_story !== undefined) {
    const n = checkInt(String(edits.mission_max_retries_per_story), 0, 10);
    if (n === null) {
      return { loop: merged, changed, invalid: 'Mission 每个 Story 最大重试次数须为 0..10 的整数' };
    }
    if (n !== num(ms.max_retries_per_story)) {
      ms.max_retries_per_story = n;
      changed = true;
    }
  }
  if (edits.mission_verify_instructions !== undefined) {
    const v = String(edits.mission_verify_instructions);
    if (v.length > 4000) {
      return { loop: merged, changed, invalid: 'Mission 验证说明过长（上限 4000 字）' };
    }
    if (v !== String(ms.default_verification_instructions ?? '')) {
      ms.default_verification_instructions = v;
      changed = true;
    }
  }
  if (edits.mission_verify_command !== undefined) {
    const v = String(edits.mission_verify_command);
    if (v.length > 2000) {
      return { loop: merged, changed, invalid: 'Mission 验证命令过长（上限 2000 字）' };
    }
    if (v !== String(ms.default_verify_command ?? '')) {
      ms.default_verify_command = v;
      changed = true;
    }
  }

  return { loop: merged, changed, invalid: '' };
}

export interface QwenpawDiffOptions {
  /** Raw loop JSON draft; non-null replaces the whole `loop` object. */
  loopJson?: string | null;
  /** Doom-stage drafts; null keeps the loaded stages. */
  doomStages?: DoomStageDraft[] | null;
}

/**
 * Build the PUT body: only changed top-level keys. Nested objects that the
 * panel edits (loop / light_context_config / reme_light_memory_config) are
 * merged onto the loaded value first, because the controller replaces them
 * wholesale upstream.
 */
export function buildRuntimeConfigDiff(
  config: Rc,
  edits: EditMap,
  options: QwenpawDiffOptions = {},
): { diff: Rc; invalid: string } {
  const diff: Rc = {};
  const has = (key: string) => edits[key] !== undefined;

  // ── 基础 ──────────────────────────────────────────────
  if (has('max_input_length')) {
    const n = Number(String(edits.max_input_length).trim());
    if (!/^\d+$/.test(String(edits.max_input_length).trim()) || !Number.isFinite(n) || n < 1000) {
      return { diff, invalid: '最大输入长度须为 ≥1000 的整数' };
    }
    if (n !== num(config.max_input_length)) diff.max_input_length = n;
  }
  if (has('shell_command_timeout')) {
    const t = String(edits.shell_command_timeout).trim();
    if (!/^\d+$/.test(t) || Number(t) < 1 || Number(t) > 86400) {
      return { diff, invalid: 'Shell 命令超时须为 1..86400 的整数（秒）' };
    }
    const n = Number(t);
    if (n !== num(config.shell_command_timeout)) diff.shell_command_timeout = n;
  }
  if (has('shell_command_executable')) {
    const v = String(edits.shell_command_executable).trim();
    if (!v) return { diff, invalid: 'Shell 可执行文件不可为空' };
    if (v !== String(config.shell_command_executable ?? '')) diff.shell_command_executable = v;
  }
  if (has('auto_title')) {
    const cur = cloneObject(config.auto_title_config);
    if (edits.auto_title !== (cur.enabled === true)) {
      diff.auto_title_config = { ...cur, enabled: edits.auto_title === true };
    }
  }
  if (has('memory_manager_backend')) {
    const v = String(edits.memory_manager_backend).trim();
    if (!v) return { diff, invalid: '记忆后端不可为空' };
    if (v !== String(config.memory_manager_backend ?? '')) diff.memory_manager_backend = v;
  }

  // ── LLM 自动重试 ──────────────────────────────────────
  if (has('llm_retry_enabled') && edits.llm_retry_enabled !== (config.llm_retry_enabled === true)) {
    diff.llm_retry_enabled = edits.llm_retry_enabled === true;
  }
  if (has('llm_max_retries')) {
    if (!isPosInt(String(edits.llm_max_retries))) {
      return { diff, invalid: '最大重试次数须为正整数' };
    }
    const n = Number(edits.llm_max_retries);
    if (n !== num(config.llm_max_retries)) diff.llm_max_retries = n;
  }
  let baseNum: number | null = null;
  let capNum: number | null = null;
  let baseChanged = false;
  let capChanged = false;
  if (has('llm_backoff_base')) {
    if (!isPosNum(String(edits.llm_backoff_base))) {
      return { diff, invalid: '退避基数须为正数（秒）' };
    }
    baseNum = Number(edits.llm_backoff_base);
    baseChanged = baseNum !== num(config.llm_backoff_base);
  }
  if (has('llm_backoff_cap')) {
    if (!isPosNum(String(edits.llm_backoff_cap))) {
      return { diff, invalid: '退避上限须为正数（秒）' };
    }
    capNum = Number(edits.llm_backoff_cap);
    capChanged = capNum !== num(config.llm_backoff_cap);
  }
  const effectiveBase = baseNum ?? num(config.llm_backoff_base);
  const effectiveCap = capNum ?? num(config.llm_backoff_cap);
  if (effectiveBase !== null && effectiveCap !== null && effectiveCap < effectiveBase) {
    return { diff, invalid: '退避上限须 ≥ 退避基数' };
  }
  if (baseChanged && baseNum !== null) diff.llm_backoff_base = baseNum;
  if (capChanged && capNum !== null) diff.llm_backoff_cap = capNum;

  // ── 智能体 Loop 设置 ──────────────────────────────────
  let mirrorVal: number | null = null;
  const loopJson = options.loopJson ?? null;
  if (loopJson !== null) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(loopJson);
    } catch {
      return { diff, invalid: 'loop 不是合法 JSON' };
    }
    if (JSON.stringify(parsed) !== JSON.stringify(config.loop ?? null)) {
      diff.loop = parsed;
      const it = asObject(parsed).iteration;
      const max = num(asObject(it).max_iterations);
      if (max !== null) mirrorVal = max;
    }
  } else {
    const merged = buildLoopPatch(config.loop, edits, options.doomStages ?? null);
    if (merged.invalid) return { diff, invalid: merged.invalid };
    if (merged.changed && JSON.stringify(merged.loop) !== JSON.stringify(config.loop ?? null)) {
      diff.loop = merged.loop;
    }
    if (has('iteration_max')) {
      const s = String(edits.iteration_max).trim();
      if (/^\d+$/.test(s)) {
        const n = Number(s);
        if (n >= 1 && n <= 500) mirrorVal = n;
      }
    }
  }
  if (mirrorVal !== null && mirrorVal !== num(config.max_iters)) diff.max_iters = mirrorVal;

  // ── LLM 并发限流（L1-only 键）──────────────────────────
  const rateInts: Array<[string, number, number]> = [
    ['llm_max_concurrent', 1, 10000],
    ['llm_max_qpm', 0, 1000000],
    ['llm_rate_limit_pause', 0, 3600],
    ['llm_rate_limit_jitter', 0, 3600],
    ['llm_acquire_timeout', 1, 3600],
  ];
  for (const [key, lo, hi] of rateInts) {
    if (!has(key)) continue;
    const s = String(edits[key]).trim();
    if (!/^\d+$/.test(s) || Number(s) < lo || Number(s) > hi) {
      return { diff, invalid: `${key} 须为 ${lo}..${hi} 的整数` };
    }
    const n = Number(s);
    if (n !== num(config[key])) diff[key] = n;
  }

  // ── 上下文管理（L1-only，light_context_config 嵌套合并）─────
  const curLc = cloneObject(config.light_context_config);
  const compact = cloneObject(curLc.context_compact_config);
  const pruning = cloneObject(curLc.tool_result_pruning_config);
  let lcChanged = false;
  const putLc = (obj: Rc, key: string, next: unknown) => {
    if (obj[key] !== next) {
      obj[key] = next;
      lcChanged = true;
    }
  };
  if (has('context_manager_backend')) {
    const v = String(edits.context_manager_backend).trim();
    if (!v) return { diff, invalid: '上下文后端不可为空' };
    if (v !== String(config.context_manager_backend ?? '')) diff.context_manager_backend = v;
  }
  if (has('token_count_estimate_divisor')) {
    const s = String(edits.token_count_estimate_divisor).trim();
    const n = Number(s);
    if (s === '' || !Number.isFinite(n) || n <= 0 || n > 10000) {
      return { diff, invalid: '上下文管理：词元估算除数须为正数' };
    }
    putLc(curLc, 'token_count_estimate_divisor', n);
  }
  if (has('dialog_path')) {
    putLc(curLc, 'dialog_path', String(edits.dialog_path).trim());
  }
  if (has('context_compact_enabled')) {
    putLc(compact, 'enabled', edits.context_compact_enabled === true);
  }
  for (const key of ['compact_threshold_ratio', 'reserve_threshold_ratio'] as const) {
    if (!has(key)) continue;
    const s = String(edits[key]).trim();
    const n = Number(s);
    if (s === '' || !Number.isFinite(n) || n <= 0 || n >= 1) {
      return { diff, invalid: '上下文管理：比例须为 (0,1) 的数' };
    }
    putLc(compact, key, n);
  }
  if (has('pruning_enabled')) {
    putLc(pruning, 'enabled', edits.pruning_enabled === true);
  }
  const pruneInts: Array<[string, number, number]> = [
    ['pruning_recent_n', 0, 100000],
    ['pruning_old_msg_max_bytes', 0, 1000000000],
    ['pruning_recent_msg_max_bytes', 0, 1000000000],
    ['offload_retention_days', 1, 3650],
  ];
  for (const [key, lo, hi] of pruneInts) {
    if (!has(key)) continue;
    const s = String(edits[key]).trim();
    if (!/^\d+$/.test(s) || Number(s) < lo || Number(s) > hi) {
      return { diff, invalid: `上下文管理：须为 ${lo}..${hi} 的整数` };
    }
    putLc(pruning, key, Number(s));
  }
  for (const key of ['exempt_file_extensions', 'exempt_tool_names'] as const) {
    if (!has(key)) continue;
    const arr = String(edits[key])
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean);
    if (JSON.stringify(arr) !== JSON.stringify(pruning[key] ?? [])) putLc(pruning, key, arr);
  }
  if (lcChanged) {
    curLc.context_compact_config = compact;
    curLc.tool_result_pruning_config = pruning;
    diff.light_context_config = curLc;
  }

  // ── 长期记忆（reme_light_memory_config，L2 白名单键）──────
  const curReme = cloneObject(config.reme_light_memory_config);
  let remeChanged = false;
  const putReme = (key: string, next: unknown) => {
    if (curReme[key] !== next) {
      curReme[key] = next;
      remeChanged = true;
    }
  };
  for (const key of ['summarize_when_compact', 'inbox_push_enabled', 'dream_cron_enabled']) {
    if (!has(`reme_${key}`)) continue;
    putReme(key, edits[`reme_${key}`] === true);
  }
  if (has('reme_auto_memory_interval')) {
    const s = String(edits.reme_auto_memory_interval).trim();
    if (!/^\d+$/.test(s) || Number(s) < 1 || Number(s) > 1440) {
      return { diff, invalid: '长期记忆：自动记忆间隔须为 1..1440 的整数' };
    }
    putReme('auto_memory_interval', Number(s));
  }
  if (has('reme_dream_cron')) {
    const v = String(edits.reme_dream_cron).trim();
    if (v.length > 200) return { diff, invalid: '长期记忆：cron 表达式过长（上限 200 字）' };
    putReme('dream_cron', v);
  }
  if (remeChanged) diff.reme_light_memory_config = curReme;

  return { diff, invalid: '' };
}
