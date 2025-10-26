import { useEffect, useState } from 'react';
import { Card, CardContent } from './ui/card';
import { RacewayAPI } from '@/api';
import type { VariableHotspot, ServiceCallHotspot } from '@/types';
import { Flame, ArrowRight, Database } from 'lucide-react';
import { ServiceLink } from './ServiceLink';
import { VariableLink } from './VariableLink';

interface SystemHotspotsProps {
  onNavigateToService: (serviceName: string) => void;
  onNavigateToVariable: (variableName: string, traceId?: string) => void;
}

export function SystemHotspots({ onNavigateToService, onNavigateToVariable }: SystemHotspotsProps) {
  const [variables, setVariables] = useState<VariableHotspot[]>([]);
  const [serviceCalls, setServiceCalls] = useState<ServiceCallHotspot[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchHotspots = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await RacewayAPI.getSystemHotspots();
        if (response.data) {
          setVariables(response.data.top_variables);
          setServiceCalls(response.data.top_service_calls);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load hotspots');
      } finally {
        setLoading(false);
      }
    };

    fetchHotspots();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading system hotspots...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400">Error: {error}</div>
      </div>
    );
  }

  const hasData = variables.length > 0 || serviceCalls.length > 0;

  if (!hasData) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-6">
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <div className="text-muted-foreground mb-2">
              <Flame className="w-12 h-12" />
            </div>
            <div className="text-lg font-medium mb-1">No Hotspots Detected</div>
            <div className="text-sm text-muted-foreground">
              Not enough activity data to identify system hotspots
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-2">System Hotspots</h2>
        <p className="text-sm text-muted-foreground">
          Most frequently accessed variables and busiest service-to-service calls
        </p>
      </div>

      {/* Variable Hotspots */}
      {variables.length > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <Database className="w-4 h-4 text-orange-400" />
              <h3 className="text-sm font-semibold">Top Variables by Access Count</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Most frequently accessed shared variables across all traces
            </p>

            <div className="space-y-2">
              {variables.map((variable, index) => {
                const intensity = Math.min(variable.access_count / variables[0].access_count, 1);
                const heatColor = `rgba(251, 146, 60, ${0.1 + intensity * 0.3})`;

                return (
                  <div
                    key={index}
                    className="border border-border/50 rounded-lg p-3"
                    style={{ backgroundColor: heatColor }}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-400 border border-orange-500/30">
                          #{index + 1}
                        </span>
                        <VariableLink
                          variableName={variable.variable}
                          onClick={onNavigateToVariable}
                          className="text-sm font-mono font-medium text-foreground/90"
                        />
                        {index === 0 && (
                          <Flame className="w-3.5 h-3.5 text-orange-400" title="Hottest" />
                        )}
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20 font-mono">
                        {variable.access_count} accesses
                      </span>
                    </div>

                    <div className="grid grid-cols-2 gap-3 text-xs">
                      <div>
                        <div className="text-muted-foreground mb-1">Traces</div>
                        <div className="font-mono text-foreground/90">{variable.trace_count}</div>
                      </div>
                      <div>
                        <div className="text-muted-foreground mb-1">Services</div>
                        <div className="flex gap-1 flex-wrap">
                          {variable.services.map((service) => (
                            <ServiceLink
                              key={service}
                              serviceName={service}
                              onClick={onNavigateToService}
                            >
                              <span className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono hover:bg-muted/80">
                                {service}
                              </span>
                            </ServiceLink>
                          ))}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Service Call Hotspots */}
      {serviceCalls.length > 0 && (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArrowRight className="w-4 h-4 text-cyan-400" />
              <h3 className="text-sm font-semibold">Busiest Service-to-Service Calls</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Most frequently used communication paths between services
            </p>

            <div className="space-y-2">
              {serviceCalls.map((call, index) => {
                const intensity = Math.min(call.call_count / serviceCalls[0].call_count, 1);
                const heatColor = `rgba(34, 211, 238, ${0.1 + intensity * 0.2})`;

                return (
                  <div
                    key={index}
                    className="border border-border/50 rounded-lg p-3"
                    style={{ backgroundColor: heatColor }}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 flex-1">
                        <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-cyan-500/20 text-cyan-400 border border-cyan-500/30">
                          #{index + 1}
                        </span>
                        <div className="flex items-center gap-2 text-sm font-mono">
                          <ServiceLink
                            serviceName={call.from_service}
                            onClick={onNavigateToService}
                            className="text-foreground/90 font-mono"
                          />
                          <ArrowRight className="w-3.5 h-3.5 text-muted-foreground" />
                          <ServiceLink
                            serviceName={call.to_service}
                            onClick={onNavigateToService}
                            className="text-foreground/90 font-mono"
                          />
                        </div>
                        {index === 0 && (
                          <Flame className="w-3.5 h-3.5 text-cyan-400" title="Busiest path" />
                        )}
                      </div>
                      <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20 font-mono">
                        {call.call_count} calls
                      </span>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Insights */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Insights</h3>
          <div className="space-y-2 text-xs">
            {variables.length > 0 && (
              <div className="flex items-start gap-2">
                <Database className="w-4 h-4 text-orange-400 mt-0.5" />
                <div>
                  <div className="font-medium text-orange-400">Variable Hotspots</div>
                  <div className="text-muted-foreground">
                    Top variable <span className="font-mono">{variables[0].variable}</span> has{' '}
                    {variables[0].access_count} accesses across {variables[0].trace_count} traces.
                    Consider caching or reducing access frequency.
                  </div>
                </div>
              </div>
            )}
            {serviceCalls.length > 0 && (
              <div className="flex items-start gap-2">
                <ArrowRight className="w-4 h-4 text-cyan-400 mt-0.5" />
                <div>
                  <div className="font-medium text-cyan-400">Service Communication</div>
                  <div className="text-muted-foreground">
                    Path <span className="font-mono">{serviceCalls[0].from_service}</span> →{' '}
                    <span className="font-mono">{serviceCalls[0].to_service}</span> has{' '}
                    {serviceCalls[0].call_count} calls. This is a critical communication path - ensure
                    it's optimized and monitored.
                  </div>
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
