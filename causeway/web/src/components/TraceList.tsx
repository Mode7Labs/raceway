import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import type { TraceMetadata } from '@/types';
import { ServiceLink } from './ServiceLink';

interface TraceListProps {
  traces: TraceMetadata[];
  selectedTraceId: string | null;
  onSelect: (traceId: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
  onNavigateToService?: (serviceName: string) => void;
}

function formatTimeAgo(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function TraceList({ traces, selectedTraceId, onSelect, onLoadMore, hasMore, loadingMore, onNavigateToService }: TraceListProps) {
  return (
    <div className="space-y-1">
      {traces.map((trace) => {
        const isSelected = trace.trace_id === selectedTraceId;
        const isDistributed = trace.service_count > 1;

        return (
          <div
            key={trace.trace_id}
            className={cn(
              "w-full flex flex-col items-start gap-1 px-3 py-2.5 rounded-md text-xs transition-all border",
              "hover:bg-muted/50 hover:border-border",
              isSelected
                ? "bg-muted border-border shadow-sm"
                : "bg-transparent border-transparent"
            )}
            title={trace.trace_id}
          >
            <div className="flex items-center justify-between w-full cursor-pointer" onClick={() => onSelect(trace.trace_id)}>
              <span className="text-foreground/90 text-xs">
                {trace.trace_id.substring(0, 8)}
              </span>
              {isDistributed && (
                <span className="text-[9px] px-1.5 py-0.5 rounded bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">
                  {trace.service_count} svc
                </span>
              )}
            </div>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground cursor-pointer" onClick={() => onSelect(trace.trace_id)}>
              <span>{trace.event_count} events</span>
              <span>•</span>
              <span>{formatTimeAgo(trace.last_timestamp)}</span>
            </div>
            {trace.services && trace.services.length > 0 && onNavigateToService && (
              <div className="flex gap-1 flex-wrap mt-0.5">
                {trace.services.map((service) => (
                  <ServiceLink
                    key={service}
                    serviceName={service}
                    onClick={onNavigateToService}
                  >
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted font-mono hover:bg-muted/80">
                      {service}
                    </span>
                  </ServiceLink>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {hasMore && onLoadMore && (
        <button
          onClick={onLoadMore}
          disabled={loadingMore}
          className={cn(
            "w-full flex items-center justify-center gap-2 px-3 py-2.5 rounded-md text-xs transition-all cursor-pointer border border-border",
            "hover:bg-muted/50",
            loadingMore && "opacity-50 cursor-not-allowed"
          )}
        >
          {loadingMore ? (
            <>
              <Loader2 className="w-3 h-3 animate-spin" />
              <span>Loading...</span>
            </>
          ) : (
            <span>Load More</span>
          )}
        </button>
      )}
    </div>
  );
}
