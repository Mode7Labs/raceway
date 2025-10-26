import { useEffect, useState } from 'react';
import { Card, CardContent } from './ui/card';
import { RacewayAPI } from '@/api';
import type { ServiceDependenciesData } from '@/types';
import { ArrowRight, ArrowLeft, ExternalLink } from 'lucide-react';
import { ServiceLink } from './ServiceLink';

interface ServiceDependenciesProps {
  serviceName: string;
  onNavigateToService: (serviceName: string) => void;
  onNavigateToServiceTraces: (serviceName: string) => void;
}

export function ServiceDependencies({ serviceName, onNavigateToService, onNavigateToServiceTraces }: ServiceDependenciesProps) {
  const [data, setData] = useState<ServiceDependenciesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchDependencies = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await RacewayAPI.getServiceDependencies(serviceName);
        if (response.data) {
          setData(response.data);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load dependencies');
      } finally {
        setLoading(false);
      }
    };

    fetchDependencies();
  }, [serviceName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading dependencies...</div>
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

  if (!data) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">No dependency data available</div>
      </div>
    );
  }

  const hasUpstream = data.called_by.length > 0;
  const hasDownstream = data.calls_to.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-2">Service Dependencies</h2>
        <p className="text-sm text-muted-foreground">
          Upstream services (called by) and downstream services (calls to)
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Upstream Dependencies (Called By) */}
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArrowLeft className="w-4 h-4 text-orange-400" />
              <h3 className="text-sm font-semibold">Upstream Services</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Services that call {serviceName}
            </p>

            {!hasUpstream ? (
              <div className="text-xs text-muted-foreground italic py-4 text-center">
                No upstream dependencies
              </div>
            ) : (
              <div className="space-y-2">
                {data.called_by.map((dep) => (
                  <div
                    key={dep.to}
                    className="border border-border/50 rounded p-2 bg-background/30 hover:bg-background transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <ServiceLink
                        serviceName={dep.to}
                        onClick={onNavigateToService}
                        className="text-sm font-mono text-foreground/90"
                      />
                      <span className="text-xs px-1.5 py-0.5 rounded bg-orange-500/10 text-orange-400 border border-orange-500/20">
                        {dep.total_calls} calls
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <div className="text-xs text-muted-foreground">
                        Across {dep.trace_count} trace{dep.trace_count !== 1 ? 's' : ''}
                      </div>
                      <button
                        onClick={() => onNavigateToServiceTraces(dep.to)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[9px] text-primary hover:underline"
                      >
                        View traces
                        <ExternalLink className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Downstream Dependencies (Calls To) */}
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <ArrowRight className="w-4 h-4 text-green-400" />
              <h3 className="text-sm font-semibold">Downstream Services</h3>
            </div>
            <p className="text-xs text-muted-foreground mb-3">
              Services called by {serviceName}
            </p>

            {!hasDownstream ? (
              <div className="text-xs text-muted-foreground italic py-4 text-center">
                No downstream dependencies
              </div>
            ) : (
              <div className="space-y-2">
                {data.calls_to.map((dep) => (
                  <div
                    key={dep.to}
                    className="border border-border/50 rounded p-2 bg-background/30 hover:bg-background transition-colors group"
                  >
                    <div className="flex items-center justify-between">
                      <ServiceLink
                        serviceName={dep.to}
                        onClick={onNavigateToService}
                        className="text-sm font-mono text-foreground/90"
                      />
                      <span className="text-xs px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 border border-green-500/20">
                        {dep.total_calls} calls
                      </span>
                    </div>
                    <div className="flex items-center justify-between mt-1">
                      <div className="text-xs text-muted-foreground">
                        Across {dep.trace_count} trace{dep.trace_count !== 1 ? 's' : ''}
                      </div>
                      <button
                        onClick={() => onNavigateToServiceTraces(dep.to)}
                        className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[9px] text-primary hover:underline"
                      >
                        View traces
                        <ExternalLink className="w-2.5 h-2.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Summary Stats */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Dependency Summary</h3>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <div className="text-xs text-muted-foreground mb-1">Upstream</div>
              <div className="text-2xl font-bold font-mono text-orange-400">
                {data.called_by.length}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Downstream</div>
              <div className="text-2xl font-bold font-mono text-green-400">
                {data.calls_to.length}
              </div>
            </div>
            <div>
              <div className="text-xs text-muted-foreground mb-1">Total Dependencies</div>
              <div className="text-2xl font-bold font-mono text-blue-400">
                {data.called_by.length + data.calls_to.length}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
