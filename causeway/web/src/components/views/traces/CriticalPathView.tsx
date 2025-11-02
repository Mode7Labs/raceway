import { useState, useMemo } from 'react';
import { type CriticalPathData, type Event } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { getEventKindColor } from '@/lib/event-colors';
import { EventTypeChart } from '@/components/features/events/EventTypeChart';
import { TraceDAGView } from '@/components/features/events/TraceDAGView';
import { Search, X, Filter, List, Network } from 'lucide-react';

interface CriticalPathViewProps {
  data: CriticalPathData | null;
  events?: Event[];
}

type CriticalPathViewMode = 'list' | 'graph';

export function CriticalPathView({ data, events = [] }: CriticalPathViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [eventKindFilter, setEventKindFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  const [viewMode, setViewMode] = useState<CriticalPathViewMode>('list');
  if (!data) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-2">
        <h3 className="text-lg font-semibold">Critical Path Not Available</h3>
        <p className="text-sm text-muted-foreground">
          Critical path analysis is not yet implemented for this trace
        </p>
      </div>
    );
  }

  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toISOString().substring(11, 23);
    } catch {
      return timestamp;
    }
  };

  // Extract unique event kinds from critical path
  const uniqueEventKinds = useMemo(() => {
    if (!data) return [];
    const kinds = new Set(data.path.map(e => e.kind));
    return Array.from(kinds).sort();
  }, [data]);

  // Filter critical path events
  const filteredPathEvents = useMemo(() => {
    if (!data) return [];
    let result = data.path;

    // Search query filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(event =>
        event.id.toLowerCase().includes(query) ||
        event.kind.toLowerCase().includes(query) ||
        event.location.toLowerCase().includes(query)
      );
    }

    // Event kind filter
    if (eventKindFilter !== 'all') {
      result = result.filter(e => e.kind === eventKindFilter);
    }

    return result;
  }, [data, searchQuery, eventKindFilter]);

  const hasActiveFilters = searchQuery.trim() !== '' || eventKindFilter !== 'all';
  const activeFilterCount = (searchQuery.trim() ? 1 : 0) + (eventKindFilter !== 'all' ? 1 : 0);

  const clearFilters = () => {
    setSearchQuery('');
    setEventKindFilter('all');
  };

  return (
    <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-3">
      <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Critical Path Summary</CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div className="space-y-0.5">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Path Events</div>
              <div className="text-sm font-medium font-mono">{data.path_events}</div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Path Duration</div>
              <div className="text-sm font-medium font-mono">{data.total_duration_ms.toFixed(2)} ms</div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Duration</div>
              <div className="text-sm font-medium font-mono">{data.trace_total_duration_ms.toFixed(2)} ms</div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Percentage</div>
              <div className="text-sm font-medium font-mono text-primary">{data.percentage_of_total.toFixed(1)}%</div>
            </div>
          </div>

          {/* Progress Bar Visualization */}
          <div className="space-y-1.5 mt-3">
            <div className="flex justify-between items-center text-[10px]">
              <span className="text-muted-foreground">Critical Path Coverage</span>
              <span className="font-medium">{data.percentage_of_total.toFixed(1)}%</span>
            </div>
            <div className="relative h-6 bg-muted rounded-md overflow-hidden">
              <div
                className="absolute inset-y-0 left-0 rounded-md transition-all duration-500"
                style={{
                  width: `${data.percentage_of_total}%`,
                  background: data.percentage_of_total > 80
                    ? 'linear-gradient(90deg, rgba(239, 68, 68, 0.8), rgba(220, 38, 38, 0.9))'
                    : data.percentage_of_total > 60
                    ? 'linear-gradient(90deg, rgba(251, 191, 36, 0.8), rgba(245, 158, 11, 0.9))'
                    : 'linear-gradient(90deg, rgba(34, 197, 94, 0.8), rgba(22, 163, 74, 0.9))'
                }}
              >
                <div className="absolute inset-0 flex items-center justify-center text-xs font-medium text-white">
                  {data.total_duration_ms.toFixed(2)} ms
                </div>
              </div>
              <div className="absolute inset-0 flex items-center justify-end pr-3 text-xs text-muted-foreground pointer-events-none">
                {data.percentage_of_total < 85 && `${data.trace_total_duration_ms.toFixed(2)} ms total`}
              </div>
            </div>
            {data.percentage_of_total > 70 && (
              <div className="flex items-center gap-1.5 text-[10px] text-orange-400 mt-1.5">
                <span>⚠️</span>
                <span>High critical path percentage - consider optimization opportunities</span>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Search and Filter */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search path events (ID, kind, location...)"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
          <Button
            variant={showFilters ? 'default' : 'outline'}
            size="sm"
            className="h-9 gap-1.5"
            onClick={() => setShowFilters(!showFilters)}
          >
            <Filter className="h-3.5 w-3.5" />
            Filters
            {activeFilterCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                {activeFilterCount}
              </Badge>
            )}
          </Button>
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              className="h-9 text-xs"
              onClick={clearFilters}
            >
              Clear All
            </Button>
          )}
          <div className="flex items-center gap-1 border border-border rounded-md p-1">
            <Button
              variant={viewMode === 'list' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-2 gap-1"
              onClick={() => setViewMode('list')}
            >
              <List className="h-3.5 w-3.5" />
              <span className="text-xs">List</span>
            </Button>
            <Button
              variant={viewMode === 'graph' ? 'default' : 'ghost'}
              size="sm"
              className="h-7 px-2 gap-1"
              onClick={() => setViewMode('graph')}
            >
              <Network className="h-3.5 w-3.5" />
              <span className="text-xs">Graph</span>
            </Button>
          </div>
        </div>

        {/* Filter Dropdown */}
        {showFilters && (
          <Card className="bg-muted/30">
            <CardContent className="p-3">
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Event Type
                </label>
                <Select
                  value={eventKindFilter}
                  onValueChange={setEventKindFilter}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {uniqueEventKinds.map(kind => (
                      <SelectItem key={kind} value={kind}>
                        {kind}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results Summary */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            Showing {filteredPathEvents.length} of {data.path.length} path events
            {hasActiveFilters && ' (filtered)'}
          </span>
        </div>
      </div>

      {viewMode === 'list' ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Critical Path Events</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {filteredPathEvents.map((pathEvent, idx) => (
                <div
                  key={pathEvent.id}
                  className="flex items-start gap-3 p-3 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors"
                >
                  <Badge variant="outline" className="mt-0.5 text-[10px]">
                    {idx + 1}
                  </Badge>
                  <div className="flex-1 space-y-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-mono text-[10px] text-muted-foreground">
                        {formatTimestamp(pathEvent.timestamp)}
                      </span>
                      <span className={cn("font-mono text-xs", getEventKindColor(pathEvent.kind))}>
                        {pathEvent.kind}
                      </span>
                      <Badge className="font-mono text-[10px] bg-rose-500/20 text-rose-300 border-rose-500/30">
                        {pathEvent.duration_ms.toFixed(2)} ms
                      </Badge>
                    </div>
                    <div className="text-[11px] text-muted-foreground truncate">
                      {pathEvent.location}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Critical Path Graph</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="h-[600px]">
              {events.length > 0 && (
                <TraceDAGView
                  events={events}
                  selectedEventId={null}
                  onEventSelect={() => {}}
                  highlightEventIds={filteredPathEvents.map(e => e.id)}
                />
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {events.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Event Type Distribution</CardTitle>
          </CardHeader>
          <CardContent>
            <EventTypeChart events={events} />
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
