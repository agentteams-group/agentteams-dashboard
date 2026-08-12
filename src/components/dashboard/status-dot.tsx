'use client';

import type { WorkerPhase, ManagerPhase, TeamPhase, HumanPhase } from '@/lib/agentteams-api';

type StatusPhase = WorkerPhase | ManagerPhase | TeamPhase | HumanPhase;

type StatusTone = 'green' | 'amber' | 'amberSlow' | 'amberFast' | 'red' | 'gray';
type StatusShape = 'circle' | 'triangle' | 'cross' | 'square';

interface ToneSpec {
  textClass: string;
  /** CSS animation class from globals.css ('' = static). */
  animClass: string;
  shape: StatusShape;
}

// Color + shape double encoding (color-blind friendly):
// green = circle, amber = triangle, red = X, gray = square.
const TONES: Record<StatusTone, ToneSpec> = {
  green: { textClass: 'text-emerald-500', animClass: 'status-dot-green', shape: 'circle' },
  amber: { textClass: 'text-amber-500', animClass: 'status-dot-amber', shape: 'triangle' },
  amberSlow: { textClass: 'text-amber-500', animClass: 'status-dot-amber-slow', shape: 'triangle' },
  amberFast: { textClass: 'text-amber-500', animClass: 'status-dot-amber-fast', shape: 'triangle' },
  red: { textClass: 'text-red-500', animClass: 'status-dot-red-fast', shape: 'cross' },
  gray: { textClass: 'text-gray-400', animClass: '', shape: 'square' },
};

function toneForPhase(phase: StatusPhase): ToneSpec {
  switch (phase) {
    case 'Running':
    case 'Ready':
    case 'Active':
      return TONES.green;
    case 'Sleeping':
      return TONES.amberSlow; // 4s gentle pulse
    case 'Pending':
    case 'Updating':
      return TONES.amberFast; // 1s fast pulse — transitional state
    case 'Failed':
    case 'Degraded':
      return TONES.red; // 0.8s urgent pulse
    case 'Stopped':
      return TONES.gray;
    default:
      return TONES.gray;
  }
}

function StatusShape({ shape }: { shape: StatusShape }) {
  // 8x8 box matches the previous w-2 h-2 dot footprint.
  if (shape === 'triangle') {
    return (
      <svg viewBox="0 0 8 8" className="w-2 h-2" aria-hidden="true">
        <path d="M4 1.2 L7.2 6.8 H0.8 Z" fill="currentColor" />
      </svg>
    );
  }
  if (shape === 'cross') {
    return (
      <svg viewBox="0 0 8 8" className="w-2 h-2" aria-hidden="true">
        <path
          d="M1.6 1.6 L6.4 6.4 M6.4 1.6 L1.6 6.4"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          fill="none"
        />
      </svg>
    );
  }
  if (shape === 'square') {
    return (
      <svg viewBox="0 0 8 8" className="w-2 h-2" aria-hidden="true">
        <rect x="1" y="1" width="6" height="6" rx="1" fill="currentColor" />
      </svg>
    );
  }
  return <span className="block w-2 h-2 rounded-full bg-current" aria-hidden="true" />;
}

export function StatusDot({ phase }: { phase: StatusPhase }) {
  const tone = toneForPhase(phase);
  return (
    <span
      role="img"
      aria-label={phase}
      className={`inline-flex items-center justify-center w-2 h-2 rounded-full ${tone.textClass} ${tone.animClass}`}
    >
      <StatusShape shape={tone.shape} />
    </span>
  );
}
