import { useEffect, useState } from 'react';
import { Card, CardContent } from '@/components/ui/card';
import { RacewayAPI } from '@/api';
import type { GlobalRace, VariableHotspot, ServiceCallHotspot, TraceMetadata, ServiceListItem } from '@/types';
import { AlertTriangle, AlertCircle, Activity, Flame, ArrowRight, TrendingUp } from 'lucide-react';
import { ServiceLink } from '@/components/features/services/ServiceLink';
import { TraceLink } from '@/components/features/traces/TraceLink';
import { VariableLink } from '@/components/shared/VariableLink';

interface DashboardProps {
  onNavigateToTrace: (traceId: string) => void;
  onNavigateToServices: () => void;
  onNavigateToRaces?: () => void;
  onNavigateToHotspots?: () => void;
  onNavigateToDependencyGraph?: () => void;
  onNavigateToTraces?: () => void;
  onNavigateToService: (serviceName: string) => void;
  onNavigateToVariable: (variableName: string, traceId?: string) => void;
  services: ServiceListItem[];
  servicesLoading: boolean;
}

export function Dashboard({ onNavigateToTrace, onNavigateToServices, onNavigateToRaces, onNavigateToHotspots, onNavigateToDependencyGraph, onNavigateToTraces, onNavigateToService, onNavigateToVariable, services, servicesLoading }: DashboardProps) {
  const [races, setRaces] = useState<GlobalRace[]>([]);
  const [hotspots, setHotspots] = useState<{ variables: VariableHotspot[], serviceCalls: ServiceCallHotspot[] }>({ variables: [], serviceCalls: [] });
  const [recentTraces, setRecentTraces] = useState<TraceMetadata[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchDashboardData = async () => {
      setLoading(true);
      try {
        const [racesRes, hotspotsRes, tracesRes] = await Promise.all([
          RacewayAPI.getGlobalRaces(),
          RacewayAPI.getSystemHotspots(),
          RacewayAPI.getTraces(1, 5),
        ]);

        if (racesRes.data) setRaces(racesRes.data.races);
        if (hotspotsRes.data) {
          setHotspots({
            variables: hotspotsRes.data.top_variables,
            serviceCalls: hotspotsRes.data.top_service_calls,
          });
        }
        if (tracesRes.data) setRecentTraces(tracesRes.data.traces);
      } catch (error) {
        console.error('Error fetching dashboard data:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchDashboardData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading dashboard...</div>
      </div>
    );
  }

  const criticalRaces = races.filter(r => r.severity === 'CRITICAL');
  const warningRaces = races.filter(r => r.severity === 'WARNING');

  return (
    <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-6">
      <div className="space-y-6">
      {/* Hero Section */}
      <div>
        <h1 className="text-3xl font-bold mb-2">System Overview</h1>
        <p className="text-muted-foreground">
          Race conditions, hotspots, and services across your distributed system
        </p>
      </div>

      {/* Race Conditions Alert */}
      {races.length > 0 ? (
        <Card className="bg-gradient-to-r from-red-500/10 to-orange-500/10 border-red-500/50">
          <CardContent className="p-6">
            <div className="flex items-start gap-4">
              <div className="mt-1">
                <AlertCircle className="w-8 h-8 text-red-400" />
              </div>
              <div className="flex-1">
                <h2 className="text-xl font-bold text-red-400 mb-2">
                  {races.length} Race Condition{races.length !== 1 ? 's' : ''} Detected in the Last 24 Hours
                </h2>
                <p className="text-sm text-muted-foreground mb-4">
                  {criticalRaces.length > 0 && (
                    <span className="text-red-400 font-medium">
                      {criticalRaces.length} Critical
                    </span>
                  )}
                  {criticalRaces.length > 0 && warningRaces.length > 0 && <span>, </span>}
                  {warningRaces.length > 0 && (
                    <span className="text-orange-400 font-medium">
                      {warningRaces.length} Warning
                    </span>
                  )}
                  {' '}- Concurrent access to shared variables without proper synchronization
                </p>

                <div className="space-y-2">
                  {races.slice(0, 3).map((race, idx) => (
                    <div
                      key={idx}
                      className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border/50 hover:border-border transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        {race.severity === 'CRITICAL' ? (
                          <AlertCircle className="w-4 h-4 text-red-400" />
                        ) : (
                          <AlertTriangle className="w-4 h-4 text-orange-400" />
                        )}
                        <div>
                          <div className="font-mono text-sm font-medium">
                            <VariableLink
                              variableName={race.variable}
                              onClick={onNavigateToVariable}
                              className="text-foreground hover:text-primary"
                            />
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {race.access_count} accesses across {race.thread_count} threads
                          </div>
                        </div>
                      </div>
                      <div className={`text-xs px-2 py-1 rounded ${
                        race.severity === 'CRITICAL'
                          ? 'bg-red-500/20 text-red-400 border border-red-500/30'
                          : 'bg-orange-500/20 text-orange-400 border border-orange-500/30'
                      }`}>
                        {race.severity}
                      </div>
                    </div>
                  ))}
                </div>

                <button
                  onClick={onNavigateToRaces}
                  className="mt-3 text-sm text-primary hover:underline flex items-center gap-1"
                >
                  {races.length > 3 ? `View all ${races.length} race conditions` : 'View all races'}
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card className="bg-gradient-to-r from-green-500/10 to-emerald-500/10 border-green-500/50">
          <CardContent className="p-6">
            <div className="flex items-center gap-4">
              <AlertCircle className="w-8 h-8 text-green-400" />
              <div>
                <h2 className="text-xl font-bold text-green-400 mb-1">No Race Conditions Detected</h2>
                <p className="text-sm text-muted-foreground">
                  All shared variables are properly synchronized
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* System Overview Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card
          className="bg-card/50 border-border/50 cursor-pointer hover:border-border transition-colors"
          onClick={onNavigateToTraces}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Activity className="w-4 h-4 text-blue-400" />
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Recent Activity</div>
            </div>
            <div className="text-2xl font-bold font-mono text-blue-400 mb-1">
              {recentTraces.length}
            </div>
            <div className="text-xs text-muted-foreground">
              traces in the last hour
            </div>
          </CardContent>
        </Card>

        <Card
          className="bg-card/50 border-border/50 cursor-pointer hover:border-border transition-colors"
          onClick={onNavigateToHotspots}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Flame className="w-4 h-4 text-orange-400" />
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Hotspots</div>
            </div>
            <div className="text-2xl font-bold font-mono text-orange-400 mb-1">
              {hotspots.variables.length}
            </div>
            <div className="text-xs text-muted-foreground">
              frequently accessed variables
            </div>
          </CardContent>
        </Card>

        <Card
          className="bg-card/50 border-border/50 cursor-pointer hover:border-border transition-colors"
          onClick={onNavigateToDependencyGraph}
        >
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-cyan-400" />
              <div className="text-xs text-muted-foreground uppercase tracking-wide">Service Calls</div>
            </div>
            <div className="text-2xl font-bold font-mono text-cyan-400 mb-1">
              {hotspots.serviceCalls.length}
            </div>
            <div className="text-xs text-muted-foreground">
              active communication paths
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Recent Traces */}
      {recentTraces.length > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3">Recent Traces</h3>
            <div className="space-y-2">
              {recentTraces.map((trace) => (
                <div
                  key={trace.trace_id}
                  className="flex items-center justify-between p-3 rounded-lg bg-background/50 border border-border/50 hover:border-border transition-colors"
                >
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <TraceLink
                        traceId={trace.trace_id}
                        onClick={onNavigateToTrace}
                        showShortId
                        className="text-muted-foreground hover:text-primary"
                      />
                      <span className="text-xs text-muted-foreground">•</span>
                      <span className="text-xs text-muted-foreground">
                        {trace.event_count} events
                      </span>
                    </div>
                    <div className="flex gap-1">
                      {trace.services.map((service) => (
                        <ServiceLink
                          key={service}
                          serviceName={service}
                          onClick={onNavigateToService}
                        >
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted font-mono hover:bg-muted/80">
                            {service}
                          </span>
                        </ServiceLink>
                      ))}
                    </div>
                  </div>
                  <button
                    onClick={() => onNavigateToTrace(trace.trace_id)}
                    className="flex-shrink-0"
                  >
                    <ArrowRight className="w-4 h-4 text-muted-foreground hover:text-foreground" />
                  </button>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      {/* System Hotspots Preview */}
      {(hotspots.variables.length > 0 || hotspots.serviceCalls.length > 0) && (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">System Hotspots</h3>
              <button
                onClick={onNavigateToHotspots}
                className="text-xs text-primary hover:underline"
              >
                View all →
              </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Top Variables */}
              {hotspots.variables.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-2">Top Variables</div>
                  <div className="space-y-1">
                    {hotspots.variables.slice(0, 3).map((variable, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded bg-background/50 text-xs hover:bg-background transition-colors"
                      >
                        <VariableLink
                          variableName={variable.variable}
                          onClick={onNavigateToVariable}
                          className="font-mono text-foreground/90"
                        />
                        <span className="text-muted-foreground">{variable.access_count} accesses</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Top Service Calls */}
              {hotspots.serviceCalls.length > 0 && (
                <div>
                  <div className="text-xs text-muted-foreground mb-2">Busiest Paths</div>
                  <div className="space-y-1">
                    {hotspots.serviceCalls.slice(0, 3).map((call, idx) => (
                      <div
                        key={idx}
                        className="flex items-center justify-between p-2 rounded bg-background/50 text-xs hover:bg-background transition-colors"
                      >
                        <div className="flex items-center gap-1 font-mono">
                          <ServiceLink
                            serviceName={call.from_service}
                            onClick={onNavigateToService}
                            className="text-foreground/90"
                          />
                          <ArrowRight className="w-3 h-3 text-muted-foreground" />
                          <ServiceLink
                            serviceName={call.to_service}
                            onClick={onNavigateToService}
                            className="text-foreground/90"
                          />
                        </div>
                        <span className="text-muted-foreground">{call.call_count} calls</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Service Breakdown */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold">Service Breakdown</h3>
            <button
              onClick={onNavigateToServices}
              className="text-xs text-primary hover:underline"
            >
              View all →
            </button>
          </div>
          {servicesLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground text-sm">Loading services...</div>
            </div>
          ) : services.length === 0 ? (
            <div className="flex items-center justify-center py-8">
              <div className="text-muted-foreground text-sm">No services found</div>
            </div>
          ) : (
            <div className="border border-border/50 rounded-md overflow-hidden">
              <table className="w-full text-xs">
                <thead className="bg-muted/30">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-muted-foreground">
                      Service
                    </th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">
                      Events
                    </th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">
                      Traces
                    </th>
                    <th className="text-right px-4 py-2 font-medium text-muted-foreground">
                      Avg Events/Trace
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {services.map((service, index) => {
                    const avgEvents =
                      service.trace_count > 0
                        ? (service.event_count / service.trace_count).toFixed(1)
                        : '0';
                    return (
                      <tr
                        key={service.name}
                        className={`${index % 2 === 0 ? 'bg-card/30' : 'bg-transparent'} hover:bg-muted/30 cursor-pointer transition-colors`}
                        onClick={() => onNavigateToService(service.name)}
                      >
                        <td className="px-4 py-2 text-foreground/90">
                          <ServiceLink
                            serviceName={service.name}
                            onClick={onNavigateToService}
                            className="font-normal"
                          />
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-cyan-400">
                          {service.event_count.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-purple-400">
                          {service.trace_count.toLocaleString()}
                        </td>
                        <td className="px-4 py-2 text-right font-mono text-green-400">
                          {avgEvents}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>
      </div>
    </div>
  );
}
