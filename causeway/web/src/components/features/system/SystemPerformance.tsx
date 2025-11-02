import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { RacewayAPI } from '@/api';
import { Clock, Zap, TrendingDown, TrendingUp, Activity, Database, Globe, Code } from 'lucide-react';
import { ServiceLink } from '@/components/features/services/ServiceLink';
import { TraceLink } from '@/components/features/traces/TraceLink';

interface SystemPerformanceProps {
  services: string[];
  onNavigateToTrace: (traceId: string) => void;
  onNavigateToService: (serviceName: string) => void;
}

interface PerformanceMetrics {
  // Trace latency metrics
  avgTraceDuration: number;
  p50TraceDuration: number;
  p95TraceDuration: number;
  p99TraceDuration: number;
  slowestTraces: { traceId: string; duration: number; services: string[] }[];

  // Event performance
  avgEventDuration: number;
  slowOperations: { type: string; count: number; avgDuration: number }[];
  eventsByType: { type: string; count: number; avgDuration: number }[];

  // Service performance
  serviceLatency: { service: string; avgDuration: number; count: number }[];

  // Throughput
  eventsPerSecond: number;
  tracesPerSecond: number;

  // Time range
  timeRangeSeconds: number;
}

export function SystemPerformance({ services, onNavigateToTrace, onNavigateToService }: SystemPerformanceProps) {
  const [metrics, setMetrics] = useState<PerformanceMetrics | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const [hasFetched, setHasFetched] = useState(false);

  useEffect(() => {
    // Skip if already fetched (cache for the session)
    if (hasFetched && metrics) {
      setInitialLoading(false);
      return;
    }

    const fetchPerformanceMetrics = async () => {
      setInitialLoading(true);
      try {
        // Use backend-optimized performance metrics endpoint
        const response = await RacewayAPI.getPerformanceMetrics(50);

        if (!response.data) {
          setMetrics(null);
          setInitialLoading(false);
          return;
        }

        const data = response.data;

        // Map backend data to component state format
        setMetrics({
          avgTraceDuration: data.trace_latency.avg_ms,
          p50TraceDuration: data.trace_latency.p50_ms,
          p95TraceDuration: data.trace_latency.p95_ms,
          p99TraceDuration: data.trace_latency.p99_ms,
          slowestTraces: data.trace_latency.slowest_traces.map(t => ({
            traceId: t.trace_id,
            duration: t.duration_ms,
            services: t.services,
          })),
          avgEventDuration: data.event_performance.by_type.length > 0
            ? data.event_performance.by_type.reduce((sum, e) => sum + e.avg_duration_ms, 0) / data.event_performance.by_type.length
            : 0,
          slowOperations: data.event_performance.by_type
            .filter(e => e.avg_duration_ms > 100)
            .map(e => ({
              type: e.type,
              count: e.count,
              avgDuration: e.avg_duration_ms,
            })),
          eventsByType: data.event_performance.by_type.map(e => ({
            type: e.type,
            count: e.count,
            avgDuration: e.avg_duration_ms,
          })),
          serviceLatency: data.service_latency.map(s => ({
            service: s.service,
            avgDuration: s.avg_duration_ms,
            count: s.event_count,
          })),
          eventsPerSecond: data.throughput.events_per_second,
          tracesPerSecond: data.throughput.traces_per_second,
          timeRangeSeconds: data.throughput.time_range_seconds,
        });
      } catch (error) {
        console.error('Error fetching performance metrics:', error);
      } finally {
        setInitialLoading(false);
        setHasFetched(true);
      }
    };

    fetchPerformanceMetrics();
  }, [services, hasFetched, metrics]);

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading performance metrics...</div>
      </div>
    );
  }

  if (!metrics) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">No performance data available</div>
      </div>
    );
  }

  const formatDuration = (ms: number) => {
    if (ms < 1) return `${(ms * 1000).toFixed(0)}µs`;
    if (ms < 1000) return `${ms.toFixed(1)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const getEventTypeIcon = (type: string) => {
    if (type.includes('db') || type.includes('database') || type.includes('query')) {
      return <Database className="w-3.5 h-3.5" />;
    }
    if (type.includes('http') || type.includes('request') || type.includes('api')) {
      return <Globe className="w-3.5 h-3.5" />;
    }
    return <Code className="w-3.5 h-3.5" />;
  };

  return (
    <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-6">
      <div className="space-y-6">
        <div>
          <h1 className="text-3xl font-bold mb-2">System Performance</h1>
          <p className="text-muted-foreground">
            Latency, throughput, and performance metrics across your distributed system
          </p>
          <p className="text-xs text-muted-foreground mt-1 italic">
            Based on a sample of recent traces for optimal performance
          </p>
        </div>

        {/* Trace Latency Overview */}
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Clock className="w-5 h-5" />
            Trace Latency
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Average
                </div>
                <div className="text-2xl font-bold font-mono text-blue-400">
                  {formatDuration(metrics.avgTraceDuration)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Mean trace duration
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  P50 (Median)
                </div>
                <div className="text-2xl font-bold font-mono text-cyan-400">
                  {formatDuration(metrics.p50TraceDuration)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  50th percentile
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  P95
                </div>
                <div className="text-2xl font-bold font-mono text-orange-400">
                  {formatDuration(metrics.p95TraceDuration)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  95th percentile
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  P99
                </div>
                <div className="text-2xl font-bold font-mono text-red-400">
                  {formatDuration(metrics.p99TraceDuration)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  99th percentile
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Throughput Metrics */}
        <div>
          <h2 className="text-lg font-semibold mb-3 flex items-center gap-2">
            <Zap className="w-5 h-5" />
            Throughput
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Events/Second
                </div>
                <div className="text-2xl font-bold font-mono text-green-400">
                  {metrics.eventsPerSecond.toFixed(1)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Average event throughput
                </div>
              </CardContent>
            </Card>

            <Card className="bg-card/50 border-border/50">
              <CardContent className="p-4">
                <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                  Traces/Second
                </div>
                <div className="text-2xl font-bold font-mono text-purple-400">
                  {metrics.tracesPerSecond.toFixed(2)}
                </div>
                <div className="text-xs text-muted-foreground mt-1">
                  Average trace throughput
                </div>
              </CardContent>
            </Card>
          </div>
        </div>

        {/* Slowest Traces */}
        {metrics.slowestTraces.length > 0 && (
          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-red-400" />
                Slowest Traces
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Top 10 traces by end-to-end latency
              </p>

              <div className="border border-border/50 rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Rank</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Trace ID</th>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Services</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground">Duration</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.slowestTraces.map((trace, index) => (
                      <tr
                        key={trace.traceId}
                        className={`${index % 2 === 0 ? 'bg-card/30' : 'bg-transparent'} hover:bg-muted/30 cursor-pointer transition-colors`}
                        onClick={() => onNavigateToTrace(trace.traceId)}
                      >
                        <td className="px-4 py-2 text-muted-foreground">#{index + 1}</td>
                        <td className="px-4 py-2">
                          <TraceLink
                            traceId={trace.traceId}
                            onClick={onNavigateToTrace}
                            showShortId
                            className="text-foreground/90"
                          />
                        </td>
                        <td className="px-4 py-2">
                          <div className="flex gap-1 flex-wrap">
                            {trace.services.slice(0, 3).map((s, i) => (
                              <ServiceLink
                                key={i}
                                serviceName={s}
                                onClick={onNavigateToService}
                              >
                                <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted/50 text-muted-foreground hover:bg-muted">
                                  {s}
                                </span>
                              </ServiceLink>
                            ))}
                            {trace.services.length > 3 && (
                              <span className="text-[10px] px-1.5 py-0.5 text-muted-foreground">
                                +{trace.services.length - 3}
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-red-400 font-medium">
                          {formatDuration(trace.duration)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Slow Operations */}
        {metrics.slowOperations.length > 0 && (
          <Card className="bg-gradient-to-r from-orange-500/10 to-red-500/10 border-orange-500/50">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <TrendingDown className="w-4 h-4 text-orange-400" />
                Slow Operations ({">"} 100ms avg)
              </h3>
              <p className="text-xs text-muted-foreground mb-3">
                Event types with high average latency requiring optimization
              </p>

              <div className="space-y-2">
                {metrics.slowOperations.map((op, index) => (
                  <div
                    key={index}
                    className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border/50"
                  >
                    <div className="flex items-center gap-3">
                      {getEventTypeIcon(op.type)}
                      <div>
                        <div className="font-mono text-sm font-medium">{op.type}</div>
                        <div className="text-xs text-muted-foreground">{op.count} occurrences</div>
                      </div>
                    </div>
                    <div className="text-right">
                      <div className="font-mono text-sm font-bold text-orange-400">
                        {formatDuration(op.avgDuration)}
                      </div>
                      <div className="text-xs text-muted-foreground">avg duration</div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {/* Event Performance by Type */}
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Activity className="w-4 h-4" />
              Event Performance by Type
            </h3>
            <p className="text-xs text-muted-foreground mb-3">
              Average duration breakdown by event type
            </p>

            <div className="border border-border/50 rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">Type</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Count</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Avg Duration</th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">Performance</th>
                  </tr>
                </thead>
                <tbody>
                  {metrics.eventsByType.map((event, index) => {
                    const perf = event.avgDuration > 100 ? 'Slow' : event.avgDuration > 50 ? 'Medium' : 'Fast';
                    const perfColor =
                      perf === 'Slow' ? 'text-red-400' : perf === 'Medium' ? 'text-orange-400' : 'text-green-400';

                    return (
                      <tr
                        key={event.type}
                        className={index % 2 === 0 ? 'bg-card/30' : 'bg-transparent'}
                      >
                        <td className="px-4 py-2 font-mono text-foreground/90">{event.type}</td>
                        <td className="px-4 py-2 text-right font-mono text-purple-400">{event.count}</td>
                        <td className="px-4 py-2 text-right font-mono text-cyan-400">
                          {formatDuration(event.avgDuration)}
                        </td>
                        <td className={`px-4 py-2 text-right font-medium ${perfColor}`}>{perf}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>

        {/* Service Latency */}
        {metrics.serviceLatency.length > 0 && (
          <Card className="bg-card/50 border-border/50">
            <CardContent className="p-4">
              <h3 className="text-sm font-semibold mb-3">Service Latency</h3>
              <p className="text-xs text-muted-foreground mb-3">
                Average event processing time per service
              </p>

              <div className="border border-border/50 rounded-md overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30">
                    <tr>
                      <th className="text-left px-4 py-2 font-medium text-muted-foreground">Service</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground">Events</th>
                      <th className="text-right px-4 py-2 font-medium text-muted-foreground">Avg Latency</th>
                    </tr>
                  </thead>
                  <tbody>
                    {metrics.serviceLatency.map((service, index) => (
                      <tr
                        key={service.service}
                        className={`${index % 2 === 0 ? 'bg-card/30' : 'bg-transparent'} hover:bg-muted/30 cursor-pointer transition-colors`}
                        onClick={() => onNavigateToService(service.service)}
                      >
                        <td className="px-4 py-2">
                          <ServiceLink
                            serviceName={service.service}
                            onClick={onNavigateToService}
                            className="text-foreground/90 font-normal"
                          />
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-purple-400">{service.count}</td>
                        <td className="px-4 py-2 text-right font-mono text-blue-400 font-medium">
                          {formatDuration(service.avgDuration)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Summary Stats */}
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3">Summary</h3>
            <div className="grid grid-cols-2 gap-4 text-xs">
              <div className="flex justify-between">
                <span className="text-muted-foreground">Time Range:</span>
                <span className="font-mono">{formatDuration(metrics.timeRangeSeconds * 1000)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">Avg Event Duration:</span>
                <span className="font-mono text-cyan-400">{formatDuration(metrics.avgEventDuration)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
