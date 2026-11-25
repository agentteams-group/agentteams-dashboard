'use client';

import { healthScoreStrokeColor } from '@/lib/agent-health';

interface HealthRingProps {
  score: number;        // 0-100
  size?: number;        // px, default 40
  strokeWidth?: number; // px, default 3
  label?: string;       // Optional text below the score
  className?: string;
}

export function HealthRing({
  score,
  size = 40,
  strokeWidth = 3,
  label,
  className = '',
}: HealthRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const strokeColor = healthScoreStrokeColor(score);
  const center = size / 2;

  // 数字必须跟着环走：svg 与数字放进同一个 relative 盒子，数字绝对定位到环心；
  // 字号按直径缩放（100 三个字符在任何尺寸都不溢出）。
  const scoreFontSize = Math.max(8, Math.min(20, Math.round(size * 0.34)));
  return (
    <div className={`inline-flex flex-col items-center gap-0.5 ${className}`}>
      <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-muted/30"
          strokeWidth={strokeWidth}
        />
        {/* Score arc */}
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      {/* Score text centered over the ring（同层 relative 盒子内绝对定位） */}
      <span
        className="absolute inset-0 flex items-center justify-center font-bold leading-none"
        style={{ fontSize: scoreFontSize, color: strokeColor }}
      >
        {score}
      </span>
      </span>
      {label && (
        <span className="mt-0.5 text-xs leading-none text-muted-foreground">{label}</span>
      )}
    </div>
  );
}

/** Compact inline health badge — just the ring, no label */
export function HealthRingCompact({
  score,
  size = 28,
}: {
  score: number;
  size?: number;
}) {
  const strokeWidth = 2.5;
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const strokeColor = healthScoreStrokeColor(score);
  const center = size / 2;

  const scoreFontSize = Math.max(8, Math.min(14, Math.round(size * 0.38)));
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="transform -rotate-90">
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke="currentColor"
          className="text-muted/30"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={center}
          cy={center}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset 0.5s ease' }}
        />
      </svg>
      <span
        className="absolute inset-0 flex items-center justify-center font-bold leading-none"
        style={{ fontSize: scoreFontSize, color: strokeColor }}
      >
        {score}
      </span>
    </div>
  );
}
