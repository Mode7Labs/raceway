import { cn } from '@/lib/utils';
import { Loader2 } from 'lucide-react';
import type { TraceMetadata } from '@/types';

interface TraceListProps {
  traces: TraceMetadata[];
  selectedTraceId: string | null;
  onSelect: (traceId: string) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
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

export function TraceList({ traces, selectedTraceId, onSelect, onLoadMore, hasMore, loadingMore }: TraceListProps) {
  return (
    <div className="space-y-1">
      {traces.map((trace) => {
        const isSelected = trace.trace_id === selectedTraceId;

        return (
          <button
            key={trace.trace_id}
            onClick={() => onSelect(trace.trace_id)}
            className={cn(
              "w-full flex flex-col items-start gap-1 px-3 py-2.5 rounded-md text-xs transition-all cursor-pointer border",
              "hover:bg-muted/50 hover:border-border",
              isSelected
                ? "bg-muted border-border shadow-sm"
                : "bg-transparent border-transparent"
            )}
            title={trace.trace_id}
          >
            <span className="text-foreground/90 text-xs">
              {trace.trace_id.substring(0, 8)}
            </span>
            <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
              <span>{trace.event_count} events</span>
              <span>•</span>
              <span>{formatTimeAgo(trace.last_timestamp)}</span>
            </div>
          </button>
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
