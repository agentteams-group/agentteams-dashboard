import { useState, useEffect } from 'react';
import type { WorkerResponse, WorkerPhase } from '@/lib/agentteams-api';
import { PhaseBadge } from '@/components/dashboard/phase-badge';
import { StatusDot } from '@/components/dashboard/status-dot';

export function WorkerTimeline({ worker }: { worker: WorkerResponse }) {
  type TimelineEvent = { timestamp: string; phase: WorkerPhase; message?: string };
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [loading, setLoading] = useState(true);

  // Load sample timeline data (in production, fetch from API)
  useEffect(() => {
    const loadEvents = async () => {
      try {
        // Simulate loading some historical events
        const now = new Date();
        const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000);
        const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000);
        
        const sampleEvents = [
          {
            timestamp: twoHoursAgo.toISOString(),
            phase: 'Pending' as WorkerPhase,
            message: 'Worker created and scheduled',
          },
          {
            timestamp: oneHourAgo.toISOString(),
            phase: 'Running' as WorkerPhase,
            message: 'Container started successfully',
          },
          {
            timestamp: now.toISOString(),
            phase: worker.phase as WorkerPhase,
            message: worker.message || 'Current status',
          },
        ];
        
        setEvents(sampleEvents);
      } catch (err) {
        console.error('Failed to load timeline:', err);
      } finally {
        setLoading(false);
      }
    };

    loadEvents();
  }, [worker]);

  if (loading) {
    return (
      <div className="text-center py-4 text-sm text-muted-foreground">
        加载中时间线...
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="relative pl-8 border-l border-border/20 space-y-6">
        {[...events].reverse().map((event, index) => (
          <div key={index} className="relative">
            {/* Event dot */}
            <div className="absolute -left-3 top-0 w-3 h-3 rounded-full bg-emerald-500 border-2 border-white ring-2 ring-emerald-500"></div>
            
            {/* Event content */}
            <div className="bg-background rounded p-3 border border-border/50">
              <div className="flex items-start gap-2">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <PhaseBadge kind="worker" phase={event.phase} />
                    <StatusDot phase={event.phase} />
                    <span className="text-xs text-muted-foreground">{new Date(event.timestamp).toLocaleTimeString()}</span>
                  </div>
                  {event.message && (
                    <p className="text-sm font-mono text-foreground truncate">{event.message}</p>
                  )}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}