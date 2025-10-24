import { type Event } from '../types';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { getEventKindBadgeColor, getThreadIdColor } from '@/lib/event-colors';

interface EventsViewProps {
  events: Event[];
  selectedEventId: string | null;
  onEventSelect: (eventId: string) => void;
}

export function EventsView({ events, selectedEventId, onEventSelect }: EventsViewProps) {
  const getEventKind = (kind: Record<string, any>): string => {
    if (typeof kind === 'string') return kind;
    const keys = Object.keys(kind);
    if (keys.length > 0) {
      const key = keys[0];
      const value = kind[key];
      if (typeof value === 'object' && value !== null) {
        // For StateChange, extract the access_type value and format nicely
        if (key === 'StateChange' && value.access_type) {
          return `StateChange | ${value.access_type}`;
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

  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toISOString().substring(11, 23); // HH:MM:SS.mmm
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="space-y-1.5">
      {events.map((event) => {
        const isSelected = event.id === selectedEventId;
        const eventKind = getEventKind(event.kind);
        const timestamp = formatTimestamp(event.timestamp);

        return (
          <button
            key={event.id}
            onClick={() => onEventSelect(event.id)}
            className={cn(
              "w-full text-left px-3 py-2.5 rounded-md transition-all flex items-center justify-between gap-3 cursor-pointer",
              "hover:bg-accent/50",
              isSelected ? "bg-muted" : "bg-card/50"
            )}
          >
            <div className="flex items-center gap-2 flex-wrap text-xs min-w-0">
              <span className="font-mono text-muted-foreground text-[11px]">
                {timestamp}
              </span>
              {event.metadata.service_name && (
                <Badge variant="outline" className="text-[10px] font-mono bg-cyan-500/10 text-cyan-400 border-cyan-500/30">
                  {event.metadata.service_name}
                </Badge>
              )}
              <Badge className={cn("font-mono text-[10px] border", getEventKindBadgeColor(eventKind))}>
                {eventKind}
              </Badge>
              <span className="text-[11px]">
                <span className="text-muted-foreground">Thread </span>
                <span className={cn("font-mono", getThreadIdColor(event.metadata.thread_id))}>
                  {event.metadata.thread_id}
                </span>
              </span>
            </div>            {isSelected && (
              <svg className="w-3 h-3 flex-shrink-0 text-primary" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            )}
          </button>
        );
      })}
    </div>
  );
}
