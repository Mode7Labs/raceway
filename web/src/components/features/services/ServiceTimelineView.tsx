import { useMemo } from 'react';
import { type Event } from '@/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { getEventKindBackgroundColor } from '@/lib/event-colors';
import { ServiceBadge } from '@/components/features/services/ServiceBadge';

interface ServiceTimelineViewProps {
  events: Event[];
  selectedEventId: string | null;
  onEventSelect: (eventId: string) => void;
  zoomLevel: number;
}

interface TimelineEvent {
  event: Event;
  service: string;
  startTime: number;
  duration: number;
  left: number;
  width: number;
  serviceIndex: number;
  row?: number;
}

interface CrossServiceConnection {
  from: TimelineEvent;
  to: TimelineEvent;
  latencyMs: number;
}

export function ServiceTimelineView({ events, selectedEventId, onEventSelect, zoomLevel }: ServiceTimelineViewProps) {
  // Assign events to rows to avoid visual overlap within each service lane
  const assignRowsToEvents = (serviceEvents: TimelineEvent[]): void => {
    if (serviceEvents.length === 0) return;

    const sorted = [...serviceEvents].sort((a, b) => a.startTime - b.startTime);
    const rowEndTimes: number[] = [];

    sorted.forEach(event => {
      let assignedRow = 0;
      for (let i = 0; i < rowEndTimes.length; i++) {
        if (event.startTime >= rowEndTimes[i]) {
          assignedRow = i;
          break;
        }
      }

      if (assignedRow === 0 && rowEndTimes.length > 0 && event.startTime < rowEndTimes[0]) {
        assignedRow = rowEndTimes.length;
      }

      event.row = assignedRow;

      const eventEndTime = event.startTime + event.duration;
      if (assignedRow >= rowEndTimes.length) {
        rowEndTimes.push(eventEndTime);
      } else {
        rowEndTimes[assignedRow] = eventEndTime;
      }
    });
  };

  const { timelineData, services, minTime, maxTime, connections, serviceRowCounts } = useMemo(() => {
    if (events.length === 0) {
      return { timelineData: [], services: [], minTime: 0, maxTime: 0, connections: [], serviceRowCounts: new Map<string, number>() };
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

    // Create service index map
    const serviceIndexMap = new Map(services.map((s, i) => [s, i]));

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
        serviceIndex: serviceIndexMap.get(pe.service) || 0,
      };
    });

    // Build event map for quick lookup
    const eventMap = new Map(timelineData.map(te => [te.event.id, te]));

    // Find cross-service connections
    const connections: CrossServiceConnection[] = [];
    timelineData.forEach(te => {
      if (te.event.parent_id) {
        const parent = eventMap.get(te.event.parent_id);
        if (parent && parent.service !== te.service) {
          // Calculate latency (time between parent end and child start)
          const parentEndTime = parent.startTime + parent.duration;
          const latencyMs = te.startTime - parentEndTime;

          connections.push({
            from: parent,
            to: te,
            latencyMs: Math.max(0, latencyMs),
          });
        }
      }
    });

    // Assign rows to events within each service to prevent overlaps
    const serviceRowCounts = new Map<string, number>();
    services.forEach(service => {
      const serviceEvents = timelineData.filter(te => te.service === service);
      assignRowsToEvents(serviceEvents);
      const maxRow = Math.max(0, ...serviceEvents.map(te => te.row || 0));
      serviceRowCounts.set(service, maxRow + 1);
    });

    return { timelineData, services, minTime, maxTime, connections, serviceRowCounts };
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
  // const crossServiceCalls = useMemo(() => {
  //   const eventMap = new Map(events.map(e => [e.id, e]));
  //   let count = 0;
  //   events.forEach(event => {
  //     if (event.parent_id) {
  //       const parent = eventMap.get(event.parent_id);
  //       if (parent && parent.metadata.service_name !== event.metadata.service_name) {
  //         count++;
  //       }
  //     }
  //   });
  //   return count;
  // }, [events]);

  // Identify bottlenecks (events with longest duration)
  const bottleneckThreshold = useMemo(() => {
    if (timelineData.length === 0) return 0;
    const durations = timelineData.map(te => te.duration).sort((a, b) => b - a);
    // Top 10% longest events are considered bottlenecks
    const thresholdIndex = Math.floor(durations.length * 0.1);
    return durations[thresholdIndex] || durations[0] || 0;
  }, [timelineData]);

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
          const rowCount = serviceRowCounts.get(service) || 1;
          const laneHeight = Math.max(48, rowCount * 32); // Minimum 48px, 32px per row
          const eventHeight = Math.min(24, laneHeight / rowCount - 4); // Event height with padding

          // Get SDK language from the first event in this service
          const firstServiceEvent = serviceEvents[0]?.event;

          return (
            <div key={service} className="space-y-1 mb-4">
              <div className="flex items-center gap-2 text-[11px]">
                <ServiceBadge
                  serviceName={service}
                  tags={firstServiceEvent?.metadata?.tags}
                />
                <Badge variant="outline" className="text-[10px]">
                  {serviceEvents.length} events
                </Badge>
                {rowCount > 1 && (
                  <Badge variant="outline" className="text-[10px] bg-blue-500/10">
                    {rowCount} lanes
                  </Badge>
                )}
              </div>
              <div
                className="relative rounded-md bg-muted"
                style={{ height: `${laneHeight}px` }}
              >
                {serviceEvents.map((te) => {
                  const isSelected = te.event.id === selectedEventId;
                  const eventKind = getEventKind(te.event.kind);
                  const bgColor = getEventColor(te.event);
                  const isBottleneck = te.duration >= bottleneckThreshold && bottleneckThreshold > 0;
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
                        isSelected ? "border-primary ring-2 ring-primary" : "border-transparent",
                        isBottleneck && !isSelected && "ring-1 ring-yellow-500/50 shadow-lg shadow-yellow-500/20"
                      )}
                      style={{
                        left: `${te.left}%`,
                        width: `${te.width}%`,
                        top: `${topPosition}px`,
                        height: `${eventHeight}px`,
                        minWidth: '4px',
                        backgroundColor: bgColor,
                      }}
                      title={`${eventKind} @ ${formatTimestamp(te.startTime)} | Duration: ${te.duration.toFixed(2)}ms${isBottleneck ? ' ⚠️ BOTTLENECK' : ''}`}
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

        {/* SVG overlay for connection lines */}
        <svg
          className="absolute top-0 left-0 w-full pointer-events-none"
          style={{ height: `${services.reduce((acc, service) => {
            const rowCount = serviceRowCounts.get(service) || 1;
            const laneHeight = Math.max(48, rowCount * 32);
            return acc + laneHeight + 36; // 36 = space-y-1 + mb-4 + label height
          }, 40)}px` }}
        >
          <defs>
            <marker
              id="arrowhead-service"
              markerWidth="8"
              markerHeight="8"
              refX="7"
              refY="4"
              orient="auto"
            >
              <polygon points="0 0, 8 4, 0 8" fill="rgb(59, 130, 246)" opacity="0.6" />
            </marker>
          </defs>
          {connections.map((conn, idx) => {
            // Calculate cumulative heights for each service
            let fromY = 40; // Initial offset for time axis
            let toY = 40;

            for (let i = 0; i < services.length; i++) {
              const svc = services[i];
              const rowCount = serviceRowCounts.get(svc) || 1;
              const laneHeight = Math.max(48, rowCount * 32);
              const labelHeight = 36; // Height of label + spacing

              if (i < conn.from.serviceIndex) {
                fromY += laneHeight + labelHeight;
              }
              if (i < conn.to.serviceIndex) {
                toY += laneHeight + labelHeight;
              }
            }

            // Add offset to center of the lane
            const fromRowCount = serviceRowCounts.get(conn.from.service) || 1;
            const fromLaneHeight = Math.max(48, fromRowCount * 32);
            fromY += fromLaneHeight / 2;

            const toRowCount = serviceRowCounts.get(conn.to.service) || 1;
            const toLaneHeight = Math.max(48, toRowCount * 32);
            toY += toLaneHeight / 2;

            const fromX = conn.from.left + conn.from.width;
            const toX = conn.to.left;

            const midY = (fromY + toY) / 2;
            const path = `M ${fromX}% ${fromY} L ${fromX}% ${midY} L ${toX}% ${midY} L ${toX}% ${toY}`;

            const isHighlighted = conn.from.event.id === selectedEventId || conn.to.event.id === selectedEventId;

            return (
              <g key={idx}>
                <path
                  d={path}
                  stroke={isHighlighted ? "rgb(59, 130, 246)" : "rgb(59, 130, 246)"}
                  strokeWidth={isHighlighted ? "2.5" : "1.5"}
                  fill="none"
                  opacity={isHighlighted ? "0.9" : "0.4"}
                  strokeDasharray={isHighlighted ? "none" : "4 2"}
                  markerEnd="url(#arrowhead-service)"
                />
                {conn.latencyMs > 0.1 && (
                  <text
                    x={`${(fromX + toX) / 2}%`}
                    y={midY - 5}
                    fontSize="10"
                    fill="rgb(156, 163, 175)"
                    textAnchor="middle"
                    className="font-mono"
                  >
                    +{conn.latencyMs.toFixed(1)}ms
                  </text>
                )}
              </g>
            );
          })}
        </svg>
      </div>
    </div>
  );
}
