import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { RacewayAPI } from '@/api';
import type { TraceMetadata, ServiceListItem } from '@/types';
import { AlertCircle, CheckCircle, Activity } from 'lucide-react';

interface SystemHealthProps {
  services: ServiceListItem[];
}

interface ServiceHealth {
  name: string;
  status: 'healthy' | 'warning' | 'critical';
  traces: number;
  recentActivity: Date | null;
  avgEventsPerTrace: number;
}

interface HealthStats {
  healthyServices: number;
  warningServices: number;
  criticalServices: number;
  overallHealth: number;
  serviceHealth: ServiceHealth[];
  recentTraces: TraceMetadata[];
}

export function SystemHealth({ services }: SystemHealthProps) {
  const [stats, setStats] = useState<HealthStats | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);

  useEffect(() => {
    const fetchHealthData = async () => {
      try {
        // Use backend-optimized health endpoint and fetch only 5 recent traces
        const [healthResponse, tracesResponse] = await Promise.all([
          RacewayAPI.getServiceHealth(60), // 60 minute time window
          RacewayAPI.getTraces(1, 5),
        ]);

        if (!healthResponse.data || !tracesResponse.data) {
          setInitialLoading(false);
          return;
        }

        // Map backend health data to component format
        const serviceHealth: ServiceHealth[] = healthResponse.data.map((svc) => ({
          name: svc.name,
          status: svc.status,
          traces: svc.trace_count,
          recentActivity: new Date(svc.last_activity),
          avgEventsPerTrace: svc.avg_events_per_trace,
        }));

        // Count by status
        const healthyCount = serviceHealth.filter((s) => s.status === 'healthy').length;
        const warningCount = serviceHealth.filter((s) => s.status === 'warning').length;
        const criticalCount = serviceHealth.filter((s) => s.status === 'critical').length;

        // Calculate overall health score (0-100)
        const overallHealth =
          serviceHealth.length > 0
            ? Math.round((healthyCount * 100 + warningCount * 50) / serviceHealth.length)
            : 0;

        setStats({
          healthyServices: healthyCount,
          warningServices: warningCount,
          criticalServices: criticalCount,
          overallHealth,
          serviceHealth,
          recentTraces: tracesResponse.data.traces,
        });
      } catch (error) {
        console.error('Error fetching health data:', error);
      } finally {
        setInitialLoading(false);
      }
    };

    if (services.length > 0) {
      fetchHealthData();
    }
  }, [services]);

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading health metrics...</div>
      </div>
    );
  }

  if (!stats) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">No health data available</div>
      </div>
    );
  }

  const healthColor =
    stats.overallHealth >= 80
      ? 'text-green-400'
      : stats.overallHealth >= 50
      ? 'text-yellow-400'
      : 'text-red-400';

  const healthLabel =
    stats.overallHealth >= 80 ? 'Healthy' : stats.overallHealth >= 50 ? 'Degraded' : 'Critical';

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-2">System Health</h2>
        <p className="text-sm text-muted-foreground">
          Service availability and system status monitoring
        </p>
      </div>

      {/* Overall Health Score */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-6">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm text-muted-foreground mb-1">Overall System Health</div>
              <div className="flex items-center gap-3">
                <div className={`text-4xl font-bold font-mono ${healthColor}`}>
                  {stats.overallHealth}%
                </div>
                <div className={`text-lg font-medium ${healthColor}`}>{healthLabel}</div>
              </div>
            </div>
            <div className="flex gap-4">
              <div className="text-center">
                <div className="flex items-center gap-1 text-green-400 mb-1">
                  <CheckCircle className="w-4 h-4" />
                  <span className="text-xs font-medium">Healthy</span>
                </div>
                <div className="text-2xl font-mono text-green-400">
                  {stats.healthyServices}
                </div>
              </div>
              <div className="text-center">
                <div className="flex items-center gap-1 text-yellow-400 mb-1">
                  <Activity className="w-4 h-4" />
                  <span className="text-xs font-medium">Warning</span>
                </div>
                <div className="text-2xl font-mono text-yellow-400">
                  {stats.warningServices}
                </div>
              </div>
              <div className="text-center">
                <div className="flex items-center gap-1 text-red-400 mb-1">
                  <AlertCircle className="w-4 h-4" />
                  <span className="text-xs font-medium">Critical</span>
                </div>
                <div className="text-2xl font-mono text-red-400">
                  {stats.criticalServices}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Service Health Table */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Service Status</h3>
          <div className="border border-border/50 rounded-md overflow-hidden">
            <table className="w-full text-xs">
              <thead className="bg-muted/30">
                <tr>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                    Status
                  </th>
                  <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                    Service
                  </th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">
                    Traces
                  </th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">
                    Last Activity
                  </th>
                  <th className="text-right px-4 py-2 font-medium text-muted-foreground">
                    Avg Events
                  </th>
                </tr>
              </thead>
              <tbody>
                {stats.serviceHealth.map((service, index) => {
                  const statusIcon =
                    service.status === 'healthy' ? (
                      <CheckCircle className="w-3.5 h-3.5 text-green-400" />
                    ) : service.status === 'warning' ? (
                      <Activity className="w-3.5 h-3.5 text-yellow-400" />
                    ) : (
                      <AlertCircle className="w-3.5 h-3.5 text-red-400" />
                    );

                  const statusColor =
                    service.status === 'healthy'
                      ? 'text-green-400'
                      : service.status === 'warning'
                      ? 'text-yellow-400'
                      : 'text-red-400';

                  const timeSince = service.recentActivity
                    ? formatTimeSince(service.recentActivity)
                    : 'Never';

                  return (
                    <tr
                      key={service.name}
                      className={index % 2 === 0 ? 'bg-card/30' : 'bg-transparent'}
                    >
                      <td className="px-4 py-2">
                        <div className="flex items-center gap-2">
                          {statusIcon}
                          <span className={`font-medium ${statusColor}`}>
                            {service.status.charAt(0).toUpperCase() + service.status.slice(1)}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-2 text-foreground/90">{service.name}</td>
                      <td className="px-4 py-2 text-right font-mono text-purple-400">
                        {service.traces}
                      </td>
                      <td className="px-4 py-2 text-right text-muted-foreground">{timeSince}</td>
                      <td className="px-4 py-2 text-right font-mono text-cyan-400">
                        {service.avgEventsPerTrace.toFixed(1)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* Recent Activity */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Recent Trace Activity</h3>
          <div className="space-y-2">
            {stats.recentTraces.slice(0, 5).map((trace) => {
              const isDistributed = trace.service_count > 1;
              return (
                <div
                  key={trace.trace_id}
                  className="flex items-center justify-between p-2 rounded bg-background/30 border border-border/30"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs font-mono text-foreground/90">
                      {trace.trace_id.substring(0, 8)}
                    </span>
                    {isDistributed && (
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                        {trace.service_count} svc
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 text-xs text-muted-foreground">
                    <span>{trace.event_count} events</span>
                    <span>{formatTimeSince(new Date(trace.last_timestamp))}</span>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Health Legend */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Status Definitions</h3>
          <div className="space-y-2 text-xs">
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-green-400 mt-0.5" />
              <div>
                <div className="font-medium text-green-400">Healthy</div>
                <div className="text-muted-foreground">Active within last 5 minutes</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <Activity className="w-4 h-4 text-yellow-400 mt-0.5" />
              <div>
                <div className="font-medium text-yellow-400">Warning</div>
                <div className="text-muted-foreground">Last activity 5-30 minutes ago</div>
              </div>
            </div>
            <div className="flex items-start gap-2">
              <AlertCircle className="w-4 h-4 text-red-400 mt-0.5" />
              <div>
                <div className="font-medium text-red-400">Critical</div>
                <div className="text-muted-foreground">No activity for 30+ minutes</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function formatTimeSince(date: Date): string {
  const now = new Date();
  const seconds = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}
