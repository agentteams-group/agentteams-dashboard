import mitt, { type Emitter } from 'mitt';

/**
 * Global plugin event bus backed by mitt.
 *
 * All plugins share one bus so they can communicate with each other and
 * with the host. Event names are plain strings; by convention plugins
 * namespace their own events (`<plugin-id>:<event>`), while the host emits
 * well-known lifecycle events listed below.
 */

export type PluginEventHandler = (_payload?: unknown) => void;

type BusEvents = Record<string, unknown>;

const emitter: Emitter<BusEvents> = mitt<BusEvents>();

/** Host lifecycle events emitted on the shared bus. */
export const HOST_EVENTS = {
  pluginActivated: 'host:plugin-activated',
  pluginDeactivated: 'host:plugin-deactivated',
  pluginError: 'host:plugin-error',
  sectionChanged: 'host:section-changed',
} as const;

export interface PluginEventBus {
  on: (_event: string, _handler: PluginEventHandler) => void;
  off: (_event: string, _handler: PluginEventHandler) => void;
  emit: (_event: string, _payload?: unknown) => void;
  /** Remove every listener (used in tests). */
  all: () => Map<string, Array<PluginEventHandler>>;
  clear: () => void;
}

export const pluginEventBus: PluginEventBus = {
  on: (event, handler) => emitter.on(event, handler),
  off: (event, handler) => emitter.off(event, handler),
  emit: (event, payload) => emitter.emit(event, payload),
  all: () => emitter.all as Map<string, Array<PluginEventHandler>>,
  clear: () => emitter.all.clear(),
};
