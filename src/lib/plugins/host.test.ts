'use client';

import { afterEach, describe, expect, it } from 'vitest';
import { installPluginHost, getPluginHost, HOST_GLOBAL_KEY } from './host';

describe('plugin host bridge', () => {
  afterEach(() => {
    delete (window as unknown as Record<string, unknown>)[HOST_GLOBAL_KEY];
  });

  it('installs the host global with React, ReactDOM and events', () => {
    installPluginHost();
    const host = getPluginHost();
    expect(host).not.toBeNull();
    expect(host!.React).toBeDefined();
    expect(host!.ReactDOM).toBeDefined();
    expect(typeof host!.events.on).toBe('function');
    expect(typeof host!.events.emit).toBe('function');
    expect(host!.version).toBeTruthy();
    expect(host!.pluginApiVersion).toBe(1);
  });

  it('is idempotent (does not overwrite an existing host)', () => {
    installPluginHost();
    const first = getPluginHost();
    installPluginHost();
    const second = getPluginHost();
    expect(second).toBe(first);
  });

  it('getPluginHost returns null before installation', () => {
    expect(getPluginHost()).toBeNull();
  });
});
