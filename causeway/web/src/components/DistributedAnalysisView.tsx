import { useMemo, useState } from 'react';
import { type Event, type CriticalPathData, type DistributedTraceAnalysisData, type ServiceStats } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { Network, TrendingUp, AlertTriangle, Activity } from 'lucide-react';
import { ServiceTimelineView } from './ServiceTimelineView';

interface DistributedAnalysisViewProps {
  events: Event[];
  criticalPathData: CriticalPathData | null;
  raceCount: number;
  selectedEventId?: string | null;
  onEventSelect?: (eventId: string) => void;
}

export function DistributedAnalysisView({
  events,
  criticalPathData,
  raceCount,
  selectedEventId = null,
  onEventSelect = () => {}
}: DistributedAnalysisViewProps) {
  const [showTimeline, setShowTimeline] = useState(false);

  // Compute service breakdown from events
  const data = useMemo<DistributedTraceAnalysisData | null>(() => {
    if (!events || events.length === 0) return null;

    // Group events by service and calculate durations
    const serviceMap = new Map<string, { eventCount: number; totalDuration: number }>();

    events.forEach(event => {
      const serviceName = event.metadata.service_name || '<unnamed>';
      const durationMs = (event.metadata.duration_ns || 0) / 1_000_000;

      const existing = serviceMap.get(serviceName) || { eventCount: 0, totalDuration: 0 };
      serviceMap.set(serviceName, {
        eventCount: existing.eventCount + 1,
        totalDuration: existing.totalDuration + durationMs,
      });
    });

    // Convert to array and sort by event count
    const services: ServiceStats[] = Array.from(serviceMap.entries())
      .map(([name, stats]) => ({
        name,
        event_count: stats.eventCount,
        total_duration_ms: stats.totalDuration,
      }))
      .sort((a, b) => b.event_count - a.event_count);

    // Count cross-service calls (events with parent from different service)
    let crossServiceCalls = 0;
    const eventMap = new Map(events.map(e => [e.id, e]));
    events.forEach(event => {
      if (event.parent_id) {
        const parent = eventMap.get(event.parent_id);
        if (parent && parent.metadata.service_name !== event.metadata.service_name) {
          crossServiceCalls++;
        }
      }
    });

    const isDistributed = services.length > 1;

    return {
      trace_id: events[0]?.trace_id || '',
      service_breakdown: {
        services,
        cross_service_calls: crossServiceCalls,
        total_services: services.length,
      },
      critical_path: criticalPathData ? {
        total_duration_ms: criticalPathData.total_duration_ms,
        trace_total_duration_ms: criticalPathData.trace_total_duration_ms,
        percentage_of_total: criticalPathData.percentage_of_total,
        path_events: criticalPathData.path_events,
      } : null,
      race_conditions: {
        total_races: raceCount,
        critical_races: raceCount, // We don't have severity breakdown client-side
        warning_races: 0,
      },
      is_distributed: isDistributed,
    };
  }, [events, criticalPathData, raceCount]);

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center text-muted-foreground">
          <Network className="h-12 w-12 mx-auto mb-4 opacity-50" />
          <p>No events available</p>
        </div>
      </div>
    );
  }

  const getDurationColor = (durationMs: number) => {
    if (durationMs > 10) return 'text-red-500';
    if (durationMs > 5) return 'text-yellow-500';
    return 'text-green-500';
  };

  const getRaceColor = (raceCount: number) => {
    if (raceCount > 0) return 'destructive';
    return 'secondary';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Network className="h-5 w-5" />
              {data.is_distributed
                ? `Distributed Trace Analysis (${data.service_breakdown.total_services} services)`
                : 'Single-Service Trace Analysis'}
            </CardTitle>
            <Button
              variant={showTimeline ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs gap-1.5"
              onClick={() => setShowTimeline(!showTimeline)}
            >
              <Activity className="w-3.5 h-3.5" />
              {showTimeline ? 'Hide' : 'Show'} Service Timeline
            </Button>
          </div>
        </CardHeader>
      </Card>

      {/* Service Timeline */}
      {showTimeline && (
        <ServiceTimelineView
          events={events}
          selectedEventId={selectedEventId}
          onEventSelect={onEventSelect}
          zoomLevel={1}
        />
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Service Breakdown */}
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Service Breakdown</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-2">
              {/* Table Header */}
              <div className="grid grid-cols-[2fr_1fr_1fr] gap-4 pb-2 border-b font-semibold text-sm text-muted-foreground">
                <div>Service</div>
                <div className="text-right">Events</div>
                <div className="text-right">Duration (ms)</div>
              </div>

              {/* Table Rows */}
              {data.service_breakdown.services.map((service, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-[2fr_1fr_1fr] gap-4 py-2 border-b last:border-b-0"
                >
                  <div className="font-medium truncate" title={service.name}>
                    {service.name || '<unnamed>'}
                  </div>
                  <div className="text-right text-muted-foreground">
                    {service.event_count}
                  </div>
                  <div className={cn('text-right font-mono', getDurationColor(service.total_duration_ms))}>
                    {service.total_duration_ms.toFixed(2)}
                  </div>
                </div>
              ))}

              {/* Cross-service calls summary */}
              {data.service_breakdown.cross_service_calls > 0 && (
                <div className="pt-4 mt-4 border-t">
                  <div className="text-sm text-muted-foreground italic">
                    Cross-service calls: {data.service_breakdown.cross_service_calls}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Critical Path & Race Conditions */}
        <div className="space-y-6">
          {/* Critical Path Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Critical Path
              </CardTitle>
            </CardHeader>
            <CardContent>
              {data.critical_path ? (
                <div className="space-y-3">
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Total Duration:</span>
                    <span className="font-semibold text-yellow-500">
                      {data.critical_path.total_duration_ms.toFixed(2)} ms
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Trace Duration:</span>
                    <span className="font-mono">
                      {data.critical_path.trace_total_duration_ms.toFixed(2)} ms
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Path Events:</span>
                    <span className="font-mono">{data.critical_path.path_events}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-sm text-muted-foreground">Percentage:</span>
                    <span className="font-semibold text-cyan-500">
                      {data.critical_path.percentage_of_total.toFixed(1)}%
                    </span>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">No critical path data available</p>
              )}
            </CardContent>
          </Card>

          {/* Race Conditions Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <AlertTriangle className="h-4 w-4" />
                Race Conditions
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Total Races:</span>
                  <Badge variant={getRaceColor(data.race_conditions.total_races)}>
                    {data.race_conditions.total_races}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Critical:</span>
                  <Badge variant={data.race_conditions.critical_races > 0 ? 'destructive' : 'secondary'}>
                    {data.race_conditions.critical_races}
                  </Badge>
                </div>
                <div className="flex justify-between items-center">
                  <span className="text-sm text-muted-foreground">Warning:</span>
                  <Badge variant={data.race_conditions.warning_races > 0 ? 'outline' : 'secondary'}>
                    {data.race_conditions.warning_races}
                  </Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
