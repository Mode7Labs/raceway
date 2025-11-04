import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { RacewayAPI } from '@/api';
import { Clock, Activity, TrendingUp, Zap, Code } from 'lucide-react';

interface ServicePerformanceProps {
  serviceName: string;
}

interface ServiceMetrics {
  // Event metrics
  totalEvents: number;
  eventTypes: { type: string; count: number; avgDuration: number }[];

  // Latency metrics
  avgDuration: number;
  p50Duration: number;
  p95Duration: number;
  p99Duration: number;

  // Throughput
  eventsPerSecond: number;

  // Slowest operations
  slowestEvents: { type: string; duration: number; timestamp: string }[];
}

export function ServicePerformance({ serviceName }: ServicePerformanceProps) {
  const [metrics, setMetrics] = useState<ServiceMetrics | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchServiceMetrics = async () => {
      setLoading(true);
      try {
        // Fetch recent traces that include this service (backend-filtered)
        // Limit to 20 traces to avoid making too many API calls
        const tracesResponse = await RacewayAPI.getServiceTraces(serviceName, 1, 20);

        if (!tracesResponse.data || !tracesResponse.data.traces || tracesResponse.data.traces.length === 0) {
          setMetrics(null);
          setLoading(false);
          return;
        }

        // Collect all events from traces that include this service
        const serviceEvents: any[] = [];
        const traceIds = tracesResponse.data.traces.map(t => t.trace_id);

        // Fetch trace events in parallel (with batching to avoid overwhelming the server)
        const BATCH_SIZE = 5;
        for (let i = 0; i < traceIds.length; i += BATCH_SIZE) {
          const batch = traceIds.slice(i, i + BATCH_SIZE);
          const batchResults = await Promise.allSettled(
            batch.map(traceId => RacewayAPI.getFullTraceAnalysis(traceId))
          );

          for (const result of batchResults) {
            if (result.status === 'fulfilled' && result.value.data && result.value.data.events) {
              // Filter to only events from this service
              const events = result.value.data.events.filter(
                (e: any) => e.metadata?.service_name === serviceName
              );
              serviceEvents.push(...events);
            }
          }
        }

        if (serviceEvents.length === 0) {
          setMetrics({
            totalEvents: 0,
            eventTypes: [],
            avgDuration: 0,
            p50Duration: 0,
            p95Duration: 0,
            p99Duration: 0,
            eventsPerSecond: 0,
            slowestEvents: [],
          });
          setLoading(false);
          return;
        }

        // Calculate metrics
        const eventTypeCounts = new Map<string, { count: number; totalDuration: number }>();
        const durations: number[] = [];
        const timestamps = serviceEvents.map(e => new Date(e.timestamp).getTime());
        const minTime = Math.min(...timestamps);
        const maxTime = Math.max(...timestamps);
        const timeRangeSeconds = (maxTime - minTime) / 1000;

        serviceEvents.forEach(event => {
          const duration = event.metadata?.duration_ns ? event.metadata.duration_ns / 1_000_000 : 0;
          durations.push(duration);

          // Determine event type
          let eventType = 'Unknown';
          if (typeof event.kind === 'string') {
            eventType = event.kind;
          } else if (typeof event.kind === 'object') {
            eventType = Object.keys(event.kind)[0] || 'Unknown';
          }

          if (!eventTypeCounts.has(eventType)) {
            eventTypeCounts.set(eventType, { count: 0, totalDuration: 0 });
          }
          const typeData = eventTypeCounts.get(eventType)!;
          typeData.count++;
          typeData.totalDuration += duration;
        });

        // Sort durations for percentiles
        durations.sort((a, b) => a - b);

        const p50Index = Math.floor(durations.length * 0.5);
        const p95Index = Math.floor(durations.length * 0.95);
        const p99Index = Math.floor(durations.length * 0.99);

        // Event types with avg duration
        const eventTypes = Array.from(eventTypeCounts.entries())
          .map(([type, data]) => ({
            type,
            count: data.count,
            avgDuration: data.totalDuration / data.count,
          }))
          .sort((a, b) => b.count - a.count);

        // Slowest events
        const eventsWithDuration = serviceEvents
          .map(e => ({
            type: typeof e.kind === 'string' ? e.kind : Object.keys(e.kind)[0] || 'Unknown',
            duration: e.metadata?.duration_ns ? e.metadata.duration_ns / 1_000_000 : 0,
            timestamp: e.timestamp,
          }))
          .filter(e => e.duration > 0)
          .sort((a, b) => b.duration - a.duration)
          .slice(0, 10);

        setMetrics({
          totalEvents: serviceEvents.length,
          eventTypes,
          avgDuration: durations.reduce((a, b) => a + b, 0) / durations.length,
          p50Duration: durations[p50Index] || 0,
          p95Duration: durations[p95Index] || 0,
          p99Duration: durations[p99Index] || 0,
          eventsPerSecond: timeRangeSeconds > 0 ? serviceEvents.length / timeRangeSeconds : 0,
          slowestEvents: eventsWithDuration,
        });
      } catch (error) {
        console.error('Error fetching service metrics:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchServiceMetrics();
  }, [serviceName]);

  const formatDuration = (ms: number) => {
    if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading service performance metrics...</div>
      </div>
    );
  }

  if (!metrics || metrics.totalEvents === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <div className="text-muted-foreground">No performance data available for this service</div>
          <div className="text-xs text-muted-foreground mt-2">
            This service may not have any recent events with duration tracking
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-lg font-semibold mb-1">Performance Metrics</h2>
        <p className="text-xs text-muted-foreground">
          Based on {metrics.totalEvents} events from up to 20 recent traces
        </p>
      </div>

      {/* Latency Overview */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Clock className="w-4 h-4" />
          Event Latency
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                Average
              </div>
              <div className="text-2xl font-bold font-mono text-blue-400">
                {formatDuration(metrics.avgDuration)}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                P50 (Median)
              </div>
              <div className="text-2xl font-bold font-mono text-cyan-400">
                {formatDuration(metrics.p50Duration)}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                P95
              </div>
              <div className="text-2xl font-bold font-mono text-orange-400">
                {formatDuration(metrics.p95Duration)}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                P99
              </div>
              <div className="text-2xl font-bold font-mono text-red-400">
                {formatDuration(metrics.p99Duration)}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Throughput */}
      <div>
        <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
          <Zap className="w-4 h-4" />
          Throughput
        </h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                Events/Second
              </div>
              <div className="text-2xl font-bold font-mono text-green-400">
                {metrics.eventsPerSecond.toFixed(1)}
              </div>
            </CardContent>
          </Card>

          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                Total Events
              </div>
              <div className="text-2xl font-bold font-mono text-purple-400">
                {metrics.totalEvents}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Event Type Breakdown */}
      {metrics.eventTypes.length > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Event Type Breakdown
            </h3>

            <div className="border border-border/50 rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Type</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Count</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Avg Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.eventTypes.map((event, index) => (
                    <tr
                      key={event.type}
                      className={index % 2 === 0 ? 'bg-card/30' : 'bg-transparent'}
                    >
                      <td className="px-4 py-2 font-mono text-foreground/90">{event.type}</td>
                      <td className="px-4 py-2 text-right font-mono text-purple-400">{event.count}</td>
                      <td className="px-4 py-2 text-right font-mono text-cyan-400">
                        {formatDuration(event.avgDuration)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Slowest Events */}
      {metrics.slowestEvents.length > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-red-400" />
              Slowest Events (Top 10)
            </h3>

            <div className="border border-border/50 rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Rank</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Type</th>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Timestamp</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Duration</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.slowestEvents.map((event, index) => (
                    <tr
                      key={index}
                      className={index % 2 === 0 ? 'bg-card/30' : 'bg-transparent'}
                    >
                      <td className="px-4 py-2 text-muted-foreground">#{index + 1}</td>
                      <td className="px-4 py-2 font-mono text-foreground/90">{event.type}</td>
                      <td className="px-4 py-2 text-muted-foreground text-[10px]">
                        {formatTimestamp(event.timestamp)}
                      </td>
                      <td className="px-4 py-2 text-right font-mono text-red-400 font-medium">
                        {formatDuration(event.duration)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
