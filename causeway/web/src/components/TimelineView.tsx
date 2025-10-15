import { useState, useMemo } from 'react';
import { type Event } from '../types';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { getEventKindBackgroundColor } from '@/lib/event-colors';

interface TimelineViewProps {
  events: Event[];
  selectedEventId: string | null;
  onEventSelect: (eventId: string) => void;
}

interface TimelineEvent {
  event: Event;
  thread: string;
  startTime: number;
  duration: number;
  left: number;
  width: number;
}

export function TimelineView({ events, selectedEventId, onEventSelect }: TimelineViewProps) {
  const [zoomLevel, setZoomLevel] = useState(2);
  const [scrollPosition, setScrollPosition] = useState(0);

  const { timelineData, threads, minTime, maxTime, totalDuration } = useMemo(() => {
    if (events.length === 0) {
      return { timelineData: [], threads: [], minTime: 0, maxTime: 0, totalDuration: 0 };
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

    // Create timeline events with positions
    const timelineData: TimelineEvent[] = parsedEvents.map(pe => {
      const relativeStart = pe.timestamp - minTime;
      const left = totalDuration > 0 ? (relativeStart / totalDuration) * 100 : 0;

      // Estimate event duration (use a small default if events have no duration info)
      const duration = 2; // ms - placeholder, could be calculated from next event or metadata
      const width = totalDuration > 0 ? (duration / totalDuration) * 100 : 0.5;
      const minWidth = 0.5; // Minimum width for visibility

      // Ensure events don't extend beyond the timeline (cap at 100%)
      const actualWidth = Math.max(minWidth, width);
      const maxLeft = 100 - actualWidth;
      const clampedLeft = Math.min(left, maxLeft);

      return {
        event: pe.event,
        thread: pe.thread,
        startTime: pe.timestamp,
        duration,
        left: clampedLeft,
        width: actualWidth,
      };
    });

    return { timelineData, threads, minTime, maxTime, totalDuration };
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
        <CardHeader>
          <CardTitle className="text-sm font-medium">Timeline Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Threads:</span>{' '}
              <span className="font-medium">{threads.length}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Total Events:</span>{' '}
              <span className="font-medium">{events.length}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Duration:</span>{' '}
              <span className="font-medium">{totalDuration.toFixed(2)} ms</span>
            </div>
          </div>
          {hasOverlaps && (
            <div className="p-2.5 rounded-md bg-destructive/10 border border-destructive/50 text-xs">
              ⚠️ Overlapping events detected - potential race conditions
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">Timeline</CardTitle>
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
        </CardHeader>
        <CardContent>
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

              return (
                <div key={thread} className="space-y-1 mb-4">
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span className="w-32 truncate font-mono">{thread}</span>
                    <Badge variant="outline" className="text-[10px]">
                      {threadEvents.length} events
                    </Badge>
                  </div>
                  <div
                    className={cn(
                      "relative h-12 rounded-md",
                      overlaps.length > 0 ? "bg-destructive/5 border border-destructive/30" : "bg-muted"
                    )}
                  >
                    {threadEvents.map((te) => {
                      const isSelected = te.event.id === selectedEventId;
                      const eventKind = getEventKind(te.event.kind);
                      const bgColor = getEventColor(te.event);
                      // Account for zoom when deciding to show label
                      const effectiveWidth = te.width * zoomLevel;

                      return (
                        <button
                          key={te.event.id}
                          onClick={() => onEventSelect(te.event.id)}
                          className={cn(
                            "absolute top-1/2 -translate-y-1/2 h-8 rounded-sm border-2 transition-all hover:z-10 hover:scale-110 cursor-pointer overflow-hidden",
                            isSelected ? "border-primary ring-2 ring-primary" : "border-transparent"
                          )}
                          style={{
                            left: `${te.left}%`,
                            width: `${te.width}%`,
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
        </CardContent>
      </Card>

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
    </div>
  );
}
