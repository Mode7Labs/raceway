import { type Event, type CriticalPathData, type AnomaliesData } from '@/types';
import { TraceHealth } from '@/components/features/traces/TraceHealth';
import { DashboardStats } from './DashboardStats';
import { TraceInsights } from '@/components/features/traces/TraceInsights';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { cn } from '@/lib/utils';

interface OverviewTabProps {
  events: Event[];
  criticalPathData: CriticalPathData | null;
  anomaliesData: AnomaliesData | null;
  raceCount: number;
  onNavigate?: (tab: string) => void;
}

export function OverviewTab({
  events,
  criticalPathData,
  anomaliesData,
  raceCount,
  onNavigate,
}: OverviewTabProps) {
  const criticalPathPercentage = criticalPathData?.percentage_of_total || 0;
  const anomalyCount = anomaliesData?.anomaly_count || 0;

  return (
    <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-3">
      <div className="space-y-4">
      {/* Health Score */}
      <TraceHealth
        raceCount={raceCount}
        anomalyCount={anomalyCount}
        criticalPathPercentage={criticalPathPercentage}
      />

      {/* Dashboard Stats */}
      <DashboardStats
        events={events}
        criticalPathData={criticalPathData}
        anomaliesData={anomaliesData}
        raceCount={raceCount}
        onNavigate={onNavigate}
      />

      {/* Trace Insights */}
      <TraceInsights
        events={events}
        criticalPathData={criticalPathData}
        anomaliesData={anomaliesData}
        raceCount={raceCount}
        onNavigate={onNavigate}
      />

      {/* Event Summary Preview */}
      {events.length > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium flex items-center justify-between">
              <span>Recent Events</span>
              <button
                onClick={() => onNavigate?.('events')}
                className="text-xs text-primary hover:underline"
              >
                View all {events.length} events →
              </button>
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="space-y-1.5">
              {events.slice(0, 5).map((event, idx) => {
                const kind = typeof event.kind === 'string'
                  ? event.kind
                  : Object.keys(event.kind)[0] || 'Unknown';

                return (
                  <div
                    key={event.id}
                    className="flex items-center gap-2 p-2 rounded bg-muted/30 hover:bg-muted/50 transition-colors cursor-pointer text-xs"
                    onClick={() => onNavigate?.('events')}
                  >
                    <span className="text-muted-foreground font-mono text-[10px]">
                      #{idx + 1}
                    </span>
                    <span className={cn(
                      "font-mono px-1.5 py-0.5 rounded text-[10px]",
                      kind.includes('Http') ? "bg-blue-500/20 text-blue-300" :
                      kind.includes('State') ? "bg-purple-500/20 text-purple-300" :
                      kind.includes('Function') ? "bg-green-500/20 text-green-300" :
                      kind.includes('Lock') ? "bg-orange-500/20 text-orange-300" :
                      "bg-gray-500/20 text-gray-300"
                    )}>
                      {kind}
                    </span>
                    <span className="text-muted-foreground font-mono text-[10px] truncate flex-1">
                      {event.metadata.service_name}
                    </span>
                    {event.metadata.thread_id && (
                      <span className="text-muted-foreground font-mono text-[10px] truncate">
                        {event.metadata.thread_id}
                      </span>
                    )}
                  </div>
                );
              })}
              {events.length > 5 && (
                <div className="text-center text-xs text-muted-foreground py-1">
                  ... and {events.length - 5} more events
                </div>
              )}
            </div>

            {/* Event Type Summary */}
            <div className="mt-3 pt-3 border-t border-border/30">
              <div className="text-[10px] text-muted-foreground mb-2 uppercase tracking-wide">
                Event Types
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(() => {
                  const typeCounts = events.reduce((acc, event) => {
                    const kind = typeof event.kind === 'string'
                      ? event.kind
                      : Object.keys(event.kind)[0] || 'Unknown';
                    acc[kind] = (acc[kind] || 0) + 1;
                    return acc;
                  }, {} as Record<string, number>);

                  return Object.entries(typeCounts)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 6)
                    .map(([kind, count]) => (
                      <span
                        key={kind}
                        className="px-2 py-1 rounded bg-muted text-[10px] font-mono"
                      >
                        {kind}: {count}
                      </span>
                    ));
                })()}
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Helpful Tips */}
      {raceCount === 0 && anomalyCount === 0 && (
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <span className="text-2xl">💡</span>
              <div className="space-y-1">
                <div className="font-medium text-sm">This trace looks healthy!</div>
                <p className="text-sm text-muted-foreground">
                  No race conditions or performance anomalies detected. You can explore the event timeline
                  to understand the execution flow, or check the critical path to identify potential optimizations.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
