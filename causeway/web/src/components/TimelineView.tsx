import { useState, useMemo } from 'react';
import { type Event } from '../types';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { getEventKindBackgroundColor } from '@/lib/event-colors';
import { ServiceTimelineView } from './ServiceTimelineView';
import { Network, Users } from 'lucide-react';

interface TimelineViewProps {
  events: Event[];
  selectedEventId: string | null;
  onEventSelect: (eventId: string) => void;
}

type TimelineMode = 'threads' | 'services';

interface TimelineEvent {
  event: Event;
  thread: string;
  startTime: number;
  duration: number;
  left: number;
  width: number;
  row?: number; // For vertical positioning when events overlap
}

export function TimelineView({ events, selectedEventId, onEventSelect }: TimelineViewProps) {
  const [zoomLevel, setZoomLevel] = useState(2);
  const [scrollPosition, setScrollPosition] = useState(0);
  const [mode, setMode] = useState<TimelineMode>('threads');

  // Assign events to rows to avoid visual overlap
  const assignRowsToEvents = (threadEvents: TimelineEvent[]): void => {
    if (threadEvents.length === 0) return;

    // Sort by timestamp (temporal ordering)
    const sorted = [...threadEvents].sort((a, b) => a.startTime - b.startTime);

    // Track when each row becomes available
    const rowEndTimes: number[] = [];

    sorted.forEach(event => {
      // Find the first row where this event fits (doesn't overlap)
      let assignedRow = 0;
      for (let i = 0; i < rowEndTimes.length; i++) {
        if (event.startTime >= rowEndTimes[i]) {
          assignedRow = i;
          break;
        }
      }

      // If no existing row is available, use a new row
      if (assignedRow === 0 && rowEndTimes.length > 0 && event.startTime < rowEndTimes[0]) {
        assignedRow = rowEndTimes.length;
      }

      event.row = assignedRow;

      // Update the end time for this row
      const eventEndTime = event.startTime + event.duration;
      if (assignedRow >= rowEndTimes.length) {
        rowEndTimes.push(eventEndTime);
      } else {
        rowEndTimes[assignedRow] = eventEndTime;
      }
    });
  };

  const { timelineData, threads, minTime, maxTime, totalDuration, threadRowCounts } = useMemo(() => {
    if (events.length === 0) {
      return { timelineData: [], threads: [], minTime: 0, maxTime: 0, totalDuration: 0, threadRowCounts: new Map<string, number>() };
    }

    // Parse timestamps and extract threads
    const parsedEvents = events.map(event => ({
      event,
      timestamp: new Date(event.timestamp).getTime(),
      thread: event.metadata.thread_id || 'unknown',
    }));

    const minTime = Math.min(...parsedEvents.map(e => e.timestamp));
    const maxTime = Math.max(...parsedEvents.map(e => e.timestamp));
    const totalDuration = maxTime - minTime;

    // Group events by thread
    const threadMap = new Map<string, typeof parsedEvents>();
    parsedEvents.forEach(pe => {
      const existing = threadMap.get(pe.thread) || [];
      existing.push(pe);
      threadMap.set(pe.thread, existing);
    });

    const threads = Array.from(threadMap.keys()).sort();

    // Create timeline events with positions based on timestamps
    const timelineData: TimelineEvent[] = parsedEvents.map(pe => {
      // Temporal mode: position based on timestamp
      const relativeStart = pe.timestamp - minTime;
      const left = totalDuration > 0 ? (relativeStart / totalDuration) * 100 : 0;

      const duration = 2; // ms
      const width = totalDuration > 0 ? (duration / totalDuration) * 100 : 0.5;

      const minWidth = 0.5;
      const actualWidth = Math.max(minWidth, width);
      const maxLeft = 100 - actualWidth;
      const clampedLeft = Math.min(left, maxLeft);

      return {
        event: pe.event,
        thread: pe.thread,
        startTime: pe.timestamp,
        duration: 2,
        left: clampedLeft,
        width: actualWidth,
      };
    });

    // Assign rows to events for each thread to avoid visual overlap
    const threadRowCounts = new Map<string, number>();
    threads.forEach(thread => {
      const threadEvents = timelineData.filter(te => te.thread === thread);
      assignRowsToEvents(threadEvents);

      // Calculate the number of rows needed for this thread
      const maxRow = threadEvents.reduce((max, te) => Math.max(max, te.row || 0), 0);
      threadRowCounts.set(thread, maxRow + 1);
    });

    return { timelineData, threads, minTime, maxTime, totalDuration, threadRowCounts };
  }, [events]);

  const getEventKind = (kind: Record<string, any>): string => {
    if (typeof kind === 'string') return kind;
    const keys = Object.keys(kind);
    if (keys.length > 0) {
      const key = keys[0];
      const value = kind[key];
      if (typeof value === 'object' && value !== null) {
        // For StateChange, extract the access_type value
        if (key === 'StateChange' && value.access_type) {
          return value.access_type;
        }

        // For HttpRequest, show method and URL
        if (key === 'HttpRequest') {
          const method = value.method || 'GET';
          const url = value.url || value.path || 'unknown';
          return `${method} ${url}`;
        }

        // For HttpResponse, show status code
        if (key === 'HttpResponse') {
          const status = value.status || value.status_code || '200';
          return `${status}`;
        }

        // For FunctionCall, show function name
        if (key === 'FunctionCall') {
          const funcName = value.function_name || value.name || 'unknown';
          return funcName;
        }

        // For LockAcquire, show lock type and lock ID
        if (key === 'LockAcquire') {
          const lockType = value.lock_type || 'Mutex';
          const lockId = value.lock_id || 'unknown';
          return `LockAcquire | ${lockType} | ${lockId}`;
        }

        // For LockRelease, show lock type and lock ID
        if (key === 'LockRelease') {
          const lockType = value.lock_type || 'Mutex';
          const lockId = value.lock_id || 'unknown';
          return `LockRelease | ${lockType} | ${lockId}`;
        }

        // Default: show key::subkey
        const subKeys = Object.keys(value);
        if (subKeys.length > 0) {
          return `${key}::${subKeys[0]}`;
        }
      }
      return key;
    }
    return 'Unknown';
  };

  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toISOString().substring(11, 23);
  };

  const getEventColor = (event: Event): string => {
    const kind = getEventKind(event.kind);
    return getEventKindBackgroundColor(kind);
  };

  // Detect overlapping events on the same thread
  const getOverlappingEvents = (threadId: string): TimelineEvent[][] => {
    const threadEvents = timelineData
      .filter(te => te.thread === threadId)
      .sort((a, b) => a.startTime - b.startTime);

    const overlaps: TimelineEvent[][] = [];

    for (let i = 0; i < threadEvents.length - 1; i++) {
      for (let j = i + 1; j < threadEvents.length; j++) {
        const e1 = threadEvents[i];
        const e2 = threadEvents[j];

        // Check if events overlap in time
        const e1End = e1.startTime + e1.duration;
        const e2Start = e2.startTime;

        if (e2Start < e1End) {
          overlaps.push([e1, e2]);
        }
      }
    }

    return overlaps;
  };

  const hasOverlaps = threads.some(thread => getOverlappingEvents(thread).length > 0);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-2">
        <h3 className="text-lg font-semibold">No events to display</h3>
        <p className="text-sm text-muted-foreground">
          Select a trace to view its timeline
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">Timeline</CardTitle>
          <div className="flex items-center gap-3">
            {/* View Mode Switcher */}
            <div className="flex items-center gap-1 bg-muted/30 p-1 rounded-md">
              <Button
                variant={mode === 'threads' ? 'default' : 'ghost'}
                size="sm"
                className="h-6 px-2 text-xs gap-1"
                onClick={() => setMode('threads')}
              >
                <Users className="h-3 w-3" />
                Threads
              </Button>
              <Button
                variant={mode === 'services' ? 'default' : 'ghost'}
                size="sm"
                className="h-6 px-2 text-xs gap-1"
                onClick={() => setMode('services')}
              >
                <Network className="h-3 w-3" />
                Services
              </Button>
            </div>

            {/* Zoom Controls */}
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setZoomLevel(Math.max(1, zoomLevel - 0.5))}
                disabled={zoomLevel <= 1}
              >
                -
              </Button>
              <span className="text-xs text-muted-foreground min-w-[3rem] text-center">
                {zoomLevel.toFixed(1)}x
              </span>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setZoomLevel(Math.min(5, zoomLevel + 0.5))}
                disabled={zoomLevel >= 5}
              >
                +
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs"
                onClick={() => setZoomLevel(1)}
                disabled={zoomLevel === 1}
              >
                Reset
              </Button>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {mode === 'services' ? (
            /* Service-based waterfall timeline */
            <ServiceTimelineView
              events={events}
              selectedEventId={selectedEventId}
              onEventSelect={onEventSelect}
              zoomLevel={zoomLevel}
            />
          ) : (
            /* Thread-based timeline */
            <div className="space-y-1 overflow-x-auto">
              <div style={{ width: `${100 * zoomLevel}%`, minWidth: '100%' }}>
                {/* Time axis */}
                <div className="relative h-8 mb-2 border-b border-border">
                  <div className="absolute left-0 top-0 text-[11px] text-muted-foreground">
                    {formatTimestamp(minTime)}
                  </div>
                  <div className="absolute right-0 top-0 text-[11px] text-muted-foreground">
                    {formatTimestamp(maxTime)}
                  </div>
                </div>

                {/* Thread lanes */}
                {threads.map((thread) => {
              const threadEvents = timelineData.filter(te => te.thread === thread);
              const overlaps = getOverlappingEvents(thread);
              const rowCount = threadRowCounts.get(thread) || 1;
              const laneHeight = Math.max(48, rowCount * 32); // Minimum 48px, 32px per row
              const eventHeight = Math.min(24, laneHeight / rowCount - 4); // Event height with padding

              return (
                <div key={thread} className="space-y-1 mb-4">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="w-32 truncate font-mono">{thread}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {threadEvents.length} events
                    </Badge>
                    {rowCount > 1 && (
                      <Badge variant="outline" className="text-[10px] bg-blue-500/10">
                        {rowCount} lanes
                      </Badge>
                    )}
                  </div>
                  <div
                    className={cn(
                      "relative rounded-md",
                      overlaps.length > 0 ? "bg-destructive/5 border border-destructive/30" : "bg-muted"
                    )}
                    style={{ height: `${laneHeight}px` }}
                  >
                    {threadEvents.map((te) => {
                      const isSelected = te.event.id === selectedEventId;
                      const eventKind = getEventKind(te.event.kind);
                      const bgColor = getEventColor(te.event);
                      // Account for zoom when deciding to show label
                      const effectiveWidth = te.width * zoomLevel;

                      // Calculate vertical position based on row
                      const row = te.row || 0;
                      const rowHeight = laneHeight / rowCount;
                      const topPosition = row * rowHeight + (rowHeight - eventHeight) / 2;

                      return (
                        <button
                          key={te.event.id}
                          onClick={() => onEventSelect(te.event.id)}
                          className={cn(
                            "absolute rounded-sm border-2 transition-all hover:z-10 hover:scale-110 cursor-pointer overflow-hidden",
                            isSelected ? "border-primary ring-2 ring-primary" : "border-transparent"
                          )}
                          style={{
                            left: `${te.left}%`,
                            width: `${te.width}%`,
                            top: `${topPosition}px`,
                            height: `${eventHeight}px`,
                            minWidth: '4px',
                            backgroundColor: bgColor,
                          }}
                          title={`${eventKind} @ ${formatTimestamp(te.startTime)}`}
                        >
                          <span className="text-[9px] text-white truncate px-0.5 block">
                            {effectiveWidth > 2 && eventKind}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {mode === 'threads' && (
        <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Legend</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-sm bg-blue-500/80"></div>
              <span>Read Operations</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-sm bg-orange-500/80"></div>
              <span>Write Operations</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-sm bg-green-500/80"></div>
              <span>Thread Spawn</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-sm bg-purple-500/80"></div>
              <span>Thread Join/Wait</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-sm bg-red-500/80"></div>
              <span>Lock Acquire</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-sm bg-pink-500/80"></div>
              <span>Lock Release</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-4 rounded-sm bg-gray-500/80"></div>
              <span>Other Events</span>
            </div>
          </div>
        </CardContent>
      </Card>
      )}
    </div>
  );
}
