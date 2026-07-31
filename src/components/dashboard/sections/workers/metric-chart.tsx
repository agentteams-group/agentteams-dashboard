'use client';

import { useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { MetricPoint } from '@/lib/agentteams-api';

interface MetricChartProps {
  data: MetricPoint[];
  width?: number | string;
  height?: number;
  showMemory?: boolean;
}

export function MetricChart({
  data,
  width = '100%',
  height = 200,
  showMemory = true,
}: MetricChartProps) {
  const chartData = useMemo(() => {
    return data.map((p) => ({
      ...p,
      time: new Date(p.timestamp).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }),
      cpuDisplay: `${Math.round(p.cpu)}%`,
      memoryGB: (p.memory / 1e9).toFixed(2),
    }));
  }, [data]);

  const cpuValues = data.map((p) => p.cpu);
  const maxCpu = Math.min(100, Math.max(...cpuValues, 10));
  const minCpu = Math.max(0, Math.min(...cpuValues, 5));
  const memoryBytes = data.map((p) => p.memory);
  const maxMemory = Math.max(...memoryBytes, 1e9);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-48 text-sm text-muted-foreground">
        无可用数据
      </div>
    );
  }

  return (
    <div style={{ width, height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={chartData} margin={{ top: 10, right: 60, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey="time"
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            minTickGap={30}
          />
          <YAxis
            yAxisId="cpu"
            stroke="var(--muted-foreground)"
            fontSize={11}
            tickLine={false}
            axisLine={false}
            domain={[minCpu, maxCpu]}
            tickFormatter={(v) => `${Math.round(v)}%`}
          />
          {showMemory && (
            <YAxis
              yAxisId="memory"
              orientation="right"
              stroke="var(--muted-foreground)"
              fontSize={11}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => `${(v / 1e9).toFixed(1)}G`}
            />
          )}
          <Tooltip
            labelStyle={{ color: 'var(--foreground)' }}
            contentStyle={{
              backgroundColor: 'var(--popover)',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              fontSize: '12px',
            }}
            formatter={(value, name) => {
              if (name === 'cpu') return [`${Number(value)?.toFixed(1)}%`, 'CPU'];
              if (name === 'memoryGB') return [`${Number(value)} GB`, '内存'];
              return [[value as string, name as string]];
            }}
          />
          <ReferenceLine
            yAxisId="cpu"
            y={70}
            stroke="var(--destructive)"
            strokeDasharray="4 2"
            ifOverflow="extendDomain"
          />
          <Line
            yAxisId="cpu"
            type="monotone"
            dataKey="cpu"
            name="cpu"
            stroke="hsl(var(--chart-1))"
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          {showMemory && (
            <Line
              yAxisId="memory"
              type="monotone"
              dataKey="memoryGB"
              name="memoryGB"
              stroke="hsl(var(--chart-2))"
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          )}
        </LineChart>
      </ResponsiveContainer>
      <div className="flex gap-4 mt-2 text-xs text-muted-foreground justify-center">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 rounded" style={{ background: 'hsl(var(--chart-1))' }} />
          CPU
        </span>
        {showMemory && (
          <span className="flex items-center gap-1">
            <span className="w-3 h-0.5 rounded" style={{ background: 'hsl(var(--chart-2))' }} />
            内存 (GB)
          </span>
        )}
      </div>
    </div>
  );
}
