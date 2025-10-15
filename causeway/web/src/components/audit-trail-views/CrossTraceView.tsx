import { useState, useEffect, useMemo } from 'react';
import { type AuditTrailData, type GlobalRaceDetail } from '../../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';
import { Network, ExternalLink, AlertTriangle } from 'lucide-react';
import { config } from '../../config';

interface CrossTraceViewProps {
  data: AuditTrailData;
  apiBaseUrl?: string;
  onTraceSelect?: (traceId: string) => void;
}

interface TimelineEvent {
  timestamp: Date;
  type: 'current-trace' | 'other-trace';
  traceId: string;
  threadId: string;
  location: string;
  accessType?: string;
  value?: any;
  isRace: boolean;
  severity?: string;
  description?: string;
  rawTimestamp?: string;
}

export function CrossTraceView({ data, apiBaseUrl = config.apiBaseUrl, onTraceSelect }: CrossTraceViewProps) {
  const [loading, setLoading] = useState(true);
  const [crossTraceRaces, setCrossTraceRaces] = useState<GlobalRaceDetail[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchGlobalRaces = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${apiBaseUrl}/api/analyze/global`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.success && result.data && result.data.race_details) {
          // Filter to only races involving this variable
          const relevantRaces = result.data.race_details.filter(
            (race: GlobalRaceDetail) => race.variable === data.variable
          );

          // Filter to races involving the current trace
          const crossTraceRaces = relevantRaces.filter(
            (race: GlobalRaceDetail) =>
              race.trace1_id === data.trace_id || race.trace2_id === data.trace_id
          );

          setCrossTraceRaces(crossTraceRaces);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch global races');
      } finally {
        setLoading(false);
      }
    };

    fetchGlobalRaces();
  }, [data.variable, data.trace_id, apiBaseUrl]);

  // Build unified timeline merging current trace accesses with cross-trace events
  const timeline = useMemo<TimelineEvent[]>(() => {
    const events: TimelineEvent[] = [];

    // Add all current trace accesses
    data.accesses.forEach((access) => {
      events.push({
        timestamp: new Date(access.timestamp),
        type: 'current-trace',
        traceId: data.trace_id,
        threadId: access.thread_id,
        location: access.location,
        accessType: access.access_type,
        value: access.new_value,
        isRace: access.is_race,
      });
    });

    // Add cross-trace race events
    crossTraceRaces.forEach((race) => {
      const isTrace1Current = race.trace1_id === data.trace_id;
      const otherTraceId = isTrace1Current ? race.trace2_id : race.trace1_id;
      const otherTimestamp = isTrace1Current ? race.event2_timestamp : race.event1_timestamp;
      const otherThread = isTrace1Current ? race.event2_thread : race.event1_thread;
      const otherLocation = isTrace1Current ? race.event2_location : race.event1_location;

      // Parse timestamp - it might be in various formats
      const parsedDate = new Date(otherTimestamp);

      events.push({
        timestamp: isNaN(parsedDate.getTime()) ? new Date() : parsedDate,
        type: 'other-trace',
        traceId: otherTraceId,
        threadId: otherThread,
        location: otherLocation,
        isRace: true,
        severity: race.severity,
        description: race.description,
        rawTimestamp: otherTimestamp, // Keep original for debugging
      });
    });

    // Sort by timestamp
    return events.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  }, [data, crossTraceRaces]);

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        return timestamp;
      }
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const seconds = date.getSeconds().toString().padStart(2, '0');
      const ms = date.getMilliseconds().toString().padStart(3, '0');
      return `${hours}:${minutes}:${seconds}.${ms}`;
    } catch {
      return timestamp;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity.toUpperCase()) {
      case 'CRITICAL':
        return 'text-red-400 border-red-500/30';
      case 'WARNING':
        return 'text-yellow-400 border-yellow-500/30';
      default:
        return 'text-blue-400 border-blue-500/30';
    }
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1000) {
      return `${ms}ms`;
    } else if (ms < 60000) {
      return `${(ms / 1000).toFixed(2)}s`;
    } else if (ms < 3600000) {
      return `${(ms / 60000).toFixed(2)}m`;
    } else {
      return `${(ms / 3600000).toFixed(2)}h`;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-sm text-muted-foreground">Loading cross-trace data...</div>
      </div>
    );
  }

  if (error) {
    return (
      <Card className="bg-muted/30 border-destructive/50">
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs font-semibold text-destructive">ERROR</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0 text-xs text-destructive">
          {error}
        </CardContent>
      </Card>
    );
  }

  if (timeline.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-2">
        <Network className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="text-lg font-semibold">No Cross-Trace Activity</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          No events found for variable <span className="font-mono text-primary">{data.variable}</span>
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0 font-mono">
      {/* Legend - Sticky */}
      <div className="sticky top-0 z-20 pb-3 mb-4">
        <div className="flex items-center gap-4 text-[10px] text-muted-foreground px-3 py-2 bg-muted/95 backdrop-blur-sm rounded">
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-cyan-400"></div>
            <span>This trace ({data.trace_id.substring(0, 8)})</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-2 h-2 rounded-full bg-orange-400"></div>
            <span>Other traces</span>
          </div>
          <div className="flex items-center gap-1.5">
            <AlertTriangle className="h-3 w-3 text-destructive" />
            <span>Race condition</span>
          </div>
        </div>
      </div>

      {/* Vertical Timeline */}
      <div className="relative">
        {/* Timeline axis */}
        <div className="absolute left-[120px] top-0 bottom-0 w-[2px] bg-border"></div>

        {/* Timeline events */}
        <div className="space-y-0">
          {timeline.map((event, idx) => {
            const isCurrentTrace = event.type === 'current-trace';
            const nextEvent = timeline[idx + 1];
            const timeDiff = nextEvent
              ? nextEvent.timestamp.getTime() - event.timestamp.getTime()
              : 0;
            const showGap = timeDiff > 100; // Show visual gap if > 100ms

            return (
              <div key={idx}>
                <div className="flex items-start gap-3 relative">
                  {/* Timestamp */}
                  <div className="w-[110px] text-right text-[10px] text-muted-foreground pt-1.5">
                    {(() => {
                      const date = event.timestamp;
                      if (isNaN(date.getTime())) {
                        // Show raw timestamp for debugging
                        return event.rawTimestamp || 'Invalid';
                      }
                      const hours = date.getHours().toString().padStart(2, '0');
                      const minutes = date.getMinutes().toString().padStart(2, '0');
                      const seconds = date.getSeconds().toString().padStart(2, '0');
                      const ms = date.getMilliseconds().toString().padStart(3, '0');
                      return `${hours}:${minutes}:${seconds}.${ms}`;
                    })()}
                  </div>

                  {/* Timeline dot */}
                  <div className="relative z-10 flex-shrink-0">
                    <div
                      className={cn(
                        "w-3 h-3 rounded-full border-2 border-background",
                        isCurrentTrace ? "bg-cyan-400" : "bg-orange-400",
                        event.isRace && "ring-2 ring-destructive ring-offset-2 ring-offset-background"
                      )}
                    ></div>
                  </div>

                  {/* Event card */}
                  <div className="flex-1 pb-3">
                    <div
                      className={cn(
                        "rounded-lg border p-3",
                        isCurrentTrace
                          ? "bg-cyan-500/5 border-cyan-500/30"
                          : "bg-orange-500/5 border-orange-500/30 cursor-pointer hover:bg-orange-500/10 transition-colors",
                        event.isRace && "border-l-4 border-l-destructive"
                      )}
                      onClick={() => {
                        if (!isCurrentTrace && onTraceSelect) {
                          onTraceSelect(event.traceId);
                        }
                      }}
                    >
                      {/* Header */}
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={cn(
                              "text-[9px]",
                              isCurrentTrace
                                ? "text-cyan-400 border-cyan-500/30"
                                : "text-orange-400 border-orange-500/30"
                            )}
                          >
                            {isCurrentTrace ? `This trace` : `Trace ${event.traceId.substring(0, 8)}`}
                          </Badge>
                          {event.accessType && (
                            <Badge
                              variant="outline"
                              className={cn(
                                "text-[9px]",
                                event.accessType.includes('Read')
                                  ? "text-blue-400 border-blue-500/30"
                                  : "text-amber-400 border-amber-500/30"
                              )}
                            >
                              {event.accessType}
                            </Badge>
                          )}
                          {event.isRace && (
                            <AlertTriangle className="h-3 w-3 text-destructive" />
                          )}
                        </div>
                        {!isCurrentTrace && onTraceSelect && (
                          <button
                            onClick={() => onTraceSelect(event.traceId)}
                            className="text-blue-400 hover:text-blue-300 transition-colors"
                            title="View this trace"
                          >
                            <ExternalLink className="h-3 w-3" />
                          </button>
                        )}
                      </div>

                      {/* Details */}
                      <div className="space-y-1 text-[11px]">
                        <div className="flex items-center gap-2">
                          <span className="text-muted-foreground w-14">Thread:</span>
                          <span className="text-blue-400">{event.threadId}</span>
                        </div>
                        {event.value !== undefined && (
                          <div className="flex items-center gap-2">
                            <span className="text-muted-foreground w-14">Value:</span>
                            <span className="text-foreground font-semibold">{JSON.stringify(event.value)}</span>
                          </div>
                        )}
                        <div className="flex items-start gap-2">
                          <span className="text-muted-foreground w-14 flex-shrink-0">Location:</span>
                          <span className="text-foreground break-all">{event.location}</span>
                        </div>
                        {event.severity && (
                          <div className="flex items-center gap-2 pt-1">
                            <Badge variant="outline" className={cn("text-[9px]", getSeverityColor(event.severity))}>
                              {event.severity}
                            </Badge>
                          </div>
                        )}
                        {event.description && (
                          <div className="text-[10px] text-muted-foreground italic pt-1 border-t border-border/30 mt-2 pt-2">
                            {event.description}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Time gap indicator */}
                {showGap && nextEvent && (
                  <div className="flex items-start gap-3 py-2 relative">
                    <div className="w-[110px]"></div>
                    {/* Dotted line connector */}
                    <div className="relative z-10 flex-shrink-0 flex items-center h-full">
                      <div className="w-3 flex flex-col items-center gap-0.5 py-1">
                        <div className="w-[2px] h-2 bg-border"></div>
                        <div className="w-[2px] h-2 bg-transparent"></div>
                        <div className="w-[2px] h-2 bg-border"></div>
                      </div>
                    </div>
                    {/* Gap label */}
                    <div className="flex-1 flex items-center">
                      <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-muted/50 border border-dashed border-border">
                        <span className="text-[10px] text-muted-foreground">
                          {formatDuration(timeDiff)} gap
                        </span>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
