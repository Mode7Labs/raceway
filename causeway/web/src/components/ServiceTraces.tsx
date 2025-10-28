import { useEffect, useState } from 'react';
import { RacewayAPI } from '@/api';
import type { TraceMetadata } from '@/types';
import { cn } from '@/lib/utils';
import { formatTimeAgo } from '@/lib/time-utils';

interface ServiceTracesProps {
  serviceName: string;
  onSelectTrace: (traceId: string) => void;
  selectedTraceId: string | null;
}

export function ServiceTraces({ serviceName, onSelectTrace, selectedTraceId }: ServiceTracesProps) {
  const [traces, setTraces] = useState<TraceMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchTraces = async () => {
      setLoading(true);
      setError(null);
      try {
        // Use backend-filtered endpoint for better performance
        const response = await RacewayAPI.getServiceTraces(serviceName, 1, 100);
        if (response.data) {
          setTraces(response.data.traces);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load traces');
      } finally {
        setLoading(false);
      }
    };

    fetchTraces();
  }, [serviceName]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading traces...</div>
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

  if (traces.length === 0) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">
          No traces found for service "{serviceName}"
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-2">
          Traces for {serviceName}
        </h2>
        <p className="text-sm text-muted-foreground">
          {traces.length} trace{traces.length !== 1 ? 's' : ''} involving this service
        </p>
      </div>

      <div className="space-y-1">
        {traces.map((trace) => {
          const isSelected = trace.trace_id === selectedTraceId;
          const isDistributed = trace.service_count > 1;

          return (
            <button
              key={trace.trace_id}
              onClick={() => onSelectTrace(trace.trace_id)}
              className={cn(
                'w-full flex flex-col items-start gap-1 px-3 py-2.5 rounded-md text-xs transition-all cursor-pointer border',
                'hover:bg-muted/50 hover:border-border',
                isSelected
                  ? 'bg-muted border-border shadow-sm'
                  : 'bg-transparent border-transparent'
              )}
              title={trace.trace_id}
            >
              <div className="flex items-center justify-between w-full">
                <span className="text-foreground/90 text-xs font-mono">
                  {trace.trace_id.substring(0, 8)}
                </span>
                {isDistributed && (
                  <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                    {trace.service_count} svc
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                <span>{trace.event_count} events</span>
                <span>•</span>
                <span>{formatTimeAgo(trace.last_timestamp)}</span>
              </div>
              {trace.services.length > 1 && (
                <div className="text-[10px] text-muted-foreground">
                  Services: {trace.services.join(', ')}
                </div>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
