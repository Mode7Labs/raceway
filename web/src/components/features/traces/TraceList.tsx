/**
 * Raceway - Trace List
 *
 * List component for displaying trace list.
 *
 * @package Raceway
 * @date 2025-10-29
 */

import { cn } from '@/lib/utils';
import { Loader2, RefreshCw, Search } from 'lucide-react';
import type { TraceMetadata } from '@/types';
import { formatTimeAgo } from '@/lib/time-utils';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface TraceListProps {
  traces: TraceMetadata[];
  selectedTraceId: string | null;
  onSelect: (traceId: string) => void;
  loading?: boolean;
  error?: string | null;
  searchQuery?: string;
  onSearchChange?: (query: string) => void;
  onRefresh?: () => void;
  autoRefresh?: boolean;
  onAutoRefreshChange?: (enabled: boolean) => void;
  onLoadMore?: () => void;
  hasMore?: boolean;
  loadingMore?: boolean;
}

export function TraceList({
  traces,
  selectedTraceId,
  onSelect,
  loading,
  error,
  searchQuery,
  onSearchChange,
  onRefresh,
  autoRefresh,
  onAutoRefreshChange,
  onLoadMore,
  hasMore,
  loadingMore
}: TraceListProps) {
  return (
    <div className="flex flex-col h-full">
      {/* Header with search and controls */}
      <div className="p-3 border-b border-border/50 space-y-2 flex-shrink-0">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold">Traces</h2>
          <div className="flex items-center gap-1">
            {onRefresh && (
              <Button
                variant="ghost"
                size="sm"
                onClick={onRefresh}
                className="h-7 w-7 p-0"
                title="Refresh traces"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </Button>
            )}
            {onAutoRefreshChange && (
              <Button
                variant={autoRefresh ? "default" : "ghost"}
                size="sm"
                onClick={() => onAutoRefreshChange(!autoRefresh)}
                className="h-7 px-2 text-xs"
                title={autoRefresh ? "Auto-refresh enabled" : "Auto-refresh disabled"}
              >
                Auto
              </Button>
            )}
          </div>
        </div>

        {onSearchChange && (
          <div className="relative">
            <Search className="absolute left-2 top-1/2 transform -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search traces..."
              value={searchQuery || ''}
              onChange={(e) => onSearchChange(e.target.value)}
              className="h-8 pl-8 text-xs"
            />
          </div>
        )}
      </div>

      {/* Trace list */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading && traces.length === 0 ? (
          <div className="flex items-center justify-center p-8">
            <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
          </div>
        ) : error ? (
          <div className="text-xs text-red-400 p-2 text-center">{error}</div>
        ) : traces.length === 0 ? (
          <div className="text-xs text-muted-foreground p-2 text-center">
            No traces found
          </div>
        ) : (
          <div className="space-y-1">
            {traces.map((trace) => {
        const isSelected = trace.trace_id === selectedTraceId;
        const isDistributed = trace.service_count > 1;

        return (
          <button
            key={trace.trace_id}
            onClick={() => onSelect(trace.trace_id)}
            className={cn(
              "w-full flex flex-col items-start gap-1 px-3 py-2.5 rounded-md text-xs transition-all border cursor-pointer text-left",
              "hover:bg-muted/50 hover:border-border",
              isSelected
                ? "bg-muted border-border shadow-sm"
                : "bg-transparent border-transparent"
            )}
            title={trace.trace_id}
          >
            <div className="flex items-center justify-between w-full">
              <span className="text-foreground/90 text-xs">
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
        )}
      </div>
    </div>
  );
}
