/**
 * Vite plugin: resolve react/react-dom/jsx-runtime to the AgentTeams
 * Dashboard host's React instance instead of bundling a copy.
 *
 * Why: a plugin must share the SAME React instance as the Dashboard, or
 * hooks and context break ("two Reacts"). The Dashboard exposes its React
 * on window.__AGENTTEAMS_DASHBOARD_HOST__ before loading any plugin.
 */

const HOST_REACT = '\0dashboard-host-react';
const HOST_REACT_DOM = '\0dashboard-host-react-dom';
const HOST_JSX_RUNTIME = '\0dashboard-host-jsx-runtime';

const SHIM_HEADER = `
function __host() {
  const h = typeof window !== 'undefined' ? window.__AGENTTEAMS_DASHBOARD_HOST__ : null;
  if (!h || !h.React) {
    throw new Error(
      '[dashboard-plugin] AgentTeams Dashboard host not found. ' +
      'Plugins must run embedded inside the Dashboard (window.__AGENTTEAMS_DASHBOARD_HOST__).'
    );
  }
  return h;
}
`;

const REACT_SHIM = `${SHIM_HEADER}
const React = __host().React;
export default React;
export const {
  useState, useEffect, useMemo, useCallback, useRef, useContext, useReducer,
  useLayoutEffect, useImperativeHandle, useDebugValue, useId, useTransition,
  useDeferredValue, useSyncExternalStore, useInsertionEffect,
  createContext, createElement, cloneElement, createRef, forwardRef, lazy,
  memo, Fragment, Suspense, startTransition, Children, Component, PureComponent,
  isValidElement,
} = React;
`;

const REACT_DOM_SHIM = `${SHIM_HEADER}
const ReactDOM = __host().ReactDOM;
export default ReactDOM;
export const { createPortal, flushSync } = ReactDOM;
`;

const JSX_RUNTIME_SHIM = `${SHIM_HEADER}
const React = () => __host().React;
export const Fragment = __host().React.Fragment;
function toElement(type, props, key) {
  const R = React();
  const config = {};
  let children;
  if (props) {
    for (const k in props) {
      if (Object.prototype.hasOwnProperty.call(props, k)) {
        if (k === 'children') children = props[k];
        else config[k] = props[k];
      }
    }
  }
  if (key !== undefined) config.key = String(key);
  if (children === undefined) return R.createElement(type, config);
  if (Array.isArray(children)) return R.createElement(type, config, ...children);
  return R.createElement(type, config, children);
}
export function jsx(type, props, key) { return toElement(type, props, key); }
export function jsxs(type, props, key) { return toElement(type, props, key); }
export function jsxDEV(type, props, key) { return toElement(type, props, key); }
`;

export default function hostReact() {
  return {
    name: 'dashboard-host-react',
    enforce: 'pre',
    resolveId(source) {
      if (source === 'react') return HOST_REACT;
      if (source === 'react-dom' || source === 'react-dom/client') return HOST_REACT_DOM;
      if (source === 'react/jsx-runtime' || source === 'react/jsx-dev-runtime') return HOST_JSX_RUNTIME;
      return null;
    },
    load(id) {
      if (id === HOST_REACT) return REACT_SHIM;
      if (id === HOST_REACT_DOM) return REACT_DOM_SHIM;
      if (id === HOST_JSX_RUNTIME) return JSX_RUNTIME_SHIM;
      return null;
    },
  };
}
