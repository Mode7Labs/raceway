import { useState, useMemo } from 'react';
import { type Event } from '../types';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { getEventKindBackgroundColor } from '@/lib/event-colors';

interface ServiceTimelineViewProps {
  events: Event[];
  selectedEventId: string | null;
  onEventSelect: (eventId: string) => void;
}

interface TimelineEvent {
  event: Event;
  service: string;
  startTime: number;
  duration: number;
  left: number;
  width: number;
}

export function ServiceTimelineView({ events, selectedEventId, onEventSelect }: ServiceTimelineViewProps) {
  const [zoomLevel, setZoomLevel] = useState(2);

  const { timelineData, services, minTime, maxTime, totalDuration } = useMemo(() => {
    if (events.length === 0) {
      return { timelineData: [], services: [], minTime: 0, maxTime: 0, totalDuration: 0 };
    }

    // Parse timestamps and extract services
    const parsedEvents = events.map(event => ({
      event,
      timestamp: new Date(event.timestamp).getTime(),
      service: event.metadata.service_name || '<unnamed>',
    }));

    const minTime = Math.min(...parsedEvents.map(e => e.timestamp));
    const maxTime = Math.max(...parsedEvents.map(e => e.timestamp));
    const totalDuration = maxTime - minTime;

    // Group events by service
    const serviceMap = new Map<string, typeof parsedEvents>();
    parsedEvents.forEach(pe => {
      const existing = serviceMap.get(pe.service) || [];
      existing.push(pe);
      serviceMap.set(pe.service, existing);
    });

    // Sort services by their first event timestamp
    const services = Array.from(serviceMap.keys()).sort((a, b) => {
      const aFirst = Math.min(...(serviceMap.get(a) || []).map(e => e.timestamp));
      const bFirst = Math.min(...(serviceMap.get(b) || []).map(e => e.timestamp));
      return aFirst - bFirst;
    });

    // Create timeline events with positions
    const timelineData: TimelineEvent[] = parsedEvents.map(pe => {
      const relativeStart = pe.timestamp - minTime;
      const left = totalDuration > 0 ? (relativeStart / totalDuration) * 100 : 0;

      // Use event duration if available, otherwise use a small default
      const durationMs = pe.event.metadata.duration_ns ? pe.event.metadata.duration_ns / 1_000_000 : 2;
      const width = totalDuration > 0 ? (durationMs / totalDuration) * 100 : 0.5;
      const minWidth = 0.5; // Minimum width for visibility

      // Ensure events don't extend beyond the timeline (cap at 100%)
      const actualWidth = Math.max(minWidth, width);
      const maxLeft = 100 - actualWidth;
      const clampedLeft = Math.min(left, maxLeft);

      return {
        event: pe.event,
        service: pe.service,
        startTime: pe.timestamp,
        duration: durationMs,
        left: clampedLeft,
        width: actualWidth,
      };
    });

    return { timelineData, services, minTime, maxTime, totalDuration };
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

  // Count cross-service calls
  const crossServiceCalls = useMemo(() => {
    const eventMap = new Map(events.map(e => [e.id, e]));
    let count = 0;
    events.forEach(event => {
      if (event.parent_id) {
        const parent = eventMap.get(event.parent_id);
        if (parent && parent.metadata.service_name !== event.metadata.service_name) {
          count++;
        }
      }
    });
    return count;
  }, [events]);

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-2">
        <h3 className="text-lg font-semibold">No events to display</h3>
        <p className="text-sm text-muted-foreground">
          Select a trace to view its service timeline
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Service Timeline Overview</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-4 text-xs">
            <div>
              <span className="text-muted-foreground">Services:</span>{' '}
              <span className="font-medium">{services.length}</span>
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
          {crossServiceCalls > 0 && (
            <div className="p-2.5 rounded-md bg-blue-500/10 border border-blue-500/30 text-xs">
              🔗 {crossServiceCalls} cross-service call{crossServiceCalls !== 1 ? 's' : ''} detected
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="text-sm font-medium">Service Timeline</CardTitle>
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

              {/* Service lanes */}
              {services.map((service) => {
                const serviceEvents = timelineData.filter(te => te.service === service);

                return (
                  <div key={service} className="space-y-1 mb-4">
                    <div className="flex items-center gap-2 text-[11px]">
                      <Badge variant="outline" className="text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
                        {service}
                      </Badge>
                      <span className="text-muted-foreground">
                        {serviceEvents.length} event{serviceEvents.length !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="relative h-12 rounded-md bg-muted">
                      {serviceEvents.map((te) => {
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
                            title={`${eventKind} @ ${formatTimestamp(te.startTime)} (Thread: ${te.event.metadata.thread_id})`}
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
