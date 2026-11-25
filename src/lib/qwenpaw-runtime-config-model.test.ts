import { describe, expect, it } from 'vitest';
import {
  buildLoopPatch,
  buildRuntimeConfigDiff,
  parseLoopGates,
  type Rc,
} from './qwenpaw-runtime-config-model';

const config: Rc = {
  max_iters: 40,
  max_input_length: 131072,
  loop: {
    iteration: { enabled: true, max_iterations: 40 },
    doom_loop: { enabled: false, window_size: 3, similarity_threshold: 1 },
    rubric: { enabled: false, prompt: '', max_interventions: 3 },
  },
  llm_retry_enabled: true,
  llm_max_retries: 3,
  llm_backoff_base: 1,
  llm_backoff_cap: 10,
  shell_command_timeout: 60,
  shell_command_executable: '',
  auto_title_config: { enabled: true, extra: 'keep-me' },
  memory_manager_backend: 'remelight',
  context_manager_backend: 'light',
  light_context_config: {
    token_count_estimate_divisor: 4,
    unknown_key: 'keep-me',
    context_compact_config: { enabled: true, compact_threshold_ratio: 0.8 },
    tool_result_pruning_config: { enabled: true, exempt_file_extensions: ['.md'] },
  },
  reme_light_memory_config: {
    summarize_when_compact: true,
    unknown_key: 'keep-me',
    embedding_model_config: { model: 'x' },
  },
};

describe('qwenpaw-runtime-config-model', () => {
  it('returns no diff for untouched fields', () => {
    expect(buildRuntimeConfigDiff(config, {})).toEqual({ diff: {}, invalid: '' });
  });

  it('sends only the changed top-level key', () => {
    const { diff, invalid } = buildRuntimeConfigDiff(config, { llm_max_retries: '5' });
    expect(invalid).toBe('');
    expect(diff).toEqual({ llm_max_retries: 5 });
  });

  it('rejects a backoff cap below the base', () => {
    const { diff, invalid } = buildRuntimeConfigDiff(config, { llm_backoff_cap: '0.5' });
    expect(diff).toEqual({});
    expect(invalid).toBe('退避上限须 ≥ 退避基数');
  });

  it('mirrors the iteration gate onto max_iters and keeps untouched gates', () => {
    const { diff, invalid } = buildRuntimeConfigDiff(config, { iteration_max: '70' });
    expect(invalid).toBe('');
    expect(diff.max_iters).toBe(70);
    const loop = diff.loop as Record<string, Record<string, unknown>>;
    expect(loop.iteration.max_iterations).toBe(70);
    // untouched nested values are carried over because PUT replaces `loop`
    expect(loop.doom_loop.window_size).toBe(3);
    expect(loop.rubric.max_interventions).toBe(3);
  });

  it('merges nested context/memory objects and preserves unknown keys', () => {
    const { diff, invalid } = buildRuntimeConfigDiff(config, {
      compact_threshold_ratio: '0.7',
      reme_auto_memory_interval: '30',
    });
    expect(invalid).toBe('');
    const light = diff.light_context_config as Rc;
    expect(light.unknown_key).toBe('keep-me');
    expect((light.context_compact_config as Rc).compact_threshold_ratio).toBe(0.7);
    const reme = diff.reme_light_memory_config as Rc;
    expect(reme.unknown_key).toBe('keep-me');
    expect(reme.auto_memory_interval).toBe(30);
  });

  it('parses loop gates and tolerates missing sub-objects', () => {
    const gates = parseLoopGates(undefined);
    expect(gates.iterationEnabled).toBe(false);
    expect(gates.doomStages).toEqual([]);
    expect(gates.goalMaxIters).toBeNull();
  });

  it('keeps the whole loop object from raw JSON and mirrors its iteration max', () => {
    const { diff } = buildRuntimeConfigDiff(config, {}, {
      loopJson: JSON.stringify({ iteration: { enabled: true, max_iterations: 88 } }),
    });
    expect(diff.loop).toEqual({ iteration: { enabled: true, max_iterations: 88 } });
    expect(diff.max_iters).toBe(88);
  });

  it('buildLoopPatch ignores gate edits that match the current value', () => {
    const result = buildLoopPatch(config.loop, { iteration_max: '40' }, null);
    expect(result.changed).toBe(false);
    expect(result.invalid).toBe('');
  });
});
