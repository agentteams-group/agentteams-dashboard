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

  return (
    <div className={`inline-flex flex-col items-center gap-0.5 ${className}`}>
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
      {/* Score text centered over the ring */}
      <span
        className="absolute text-[10px] font-bold"
        style={{
          width: size,
          height: size,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          transform: 'none',
          color: strokeColor,
        }}
      >
        {score}
      </span>
      {label && (
        <span className="text-[9px] text-muted-foreground leading-none">{label}</span>
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
        className="absolute text-[8px] font-bold"
        style={{ color: strokeColor }}
      >
        {score}
      </span>
    </div>
  );
}
