// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { pluginEventBus, HOST_EVENTS } from './event-bus';

describe('pluginEventBus', () => {
  beforeEach(() => {
    pluginEventBus.clear();
  });

  it('delivers events to subscribers', () => {
    const handler = vi.fn();
    pluginEventBus.on('test:event', handler);
    pluginEventBus.emit('test:event', { value: 1 });
    expect(handler).toHaveBeenCalledWith({ value: 1 });
  });

  it('supports multiple handlers and unsubscribing via off', () => {
    const a = vi.fn();
    const b = vi.fn();
    pluginEventBus.on('evt', a);
    pluginEventBus.on('evt', b);
    pluginEventBus.off('evt', a);
    pluginEventBus.emit('evt');
    expect(a).not.toHaveBeenCalled();
    expect(b).toHaveBeenCalledTimes(1);
  });

  it('isolates different event names', () => {
    const handler = vi.fn();
    pluginEventBus.on('one', handler);
    pluginEventBus.emit('two');
    expect(handler).not.toHaveBeenCalled();
  });

  it('on returns void (unregister via off / api wrapper)', () => {
    const handler = vi.fn();
    const result = pluginEventBus.on('x', handler);
    expect(result).toBeUndefined();
    pluginEventBus.off('x', handler);
  });

  it('exposes host lifecycle event names', () => {
    expect(HOST_EVENTS.pluginActivated).toBe('host:plugin-activated');
    expect(HOST_EVENTS.pluginDeactivated).toBe('host:plugin-deactivated');
    expect(HOST_EVENTS.pluginError).toBe('host:plugin-error');
    expect(HOST_EVENTS.sectionChanged).toBe('host:section-changed');
  });

  it('clear removes all listeners', () => {
    const handler = vi.fn();
    pluginEventBus.on('evt', handler);
    pluginEventBus.clear();
    pluginEventBus.emit('evt');
    expect(handler).not.toHaveBeenCalled();
  });
});
