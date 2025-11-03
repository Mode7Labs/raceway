import { type Event } from '@/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { getThreadIdColor } from '@/lib/event-colors';
import { ServiceLink } from '@/components/features/services/ServiceLink';
import { ServiceBadge } from '@/components/features/services/ServiceBadge';
import { EventKindBadge } from './EventKindBadge';

interface EventsViewProps {
  events: Event[];
  selectedEventId: string | null;
  onEventSelect: (eventId: string) => void;
  onNavigateToService?: (serviceName: string) => void;
}

export function EventsView({ events, selectedEventId, onEventSelect, onNavigateToService }: EventsViewProps) {
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
              {event.metadata.service_name && onNavigateToService && (
                <ServiceLink
                  serviceName={event.metadata.service_name}
                  onClick={onNavigateToService}
                >
                  <ServiceBadge
                    serviceName={event.metadata.service_name}
                    tags={event.metadata.tags}
                    onClick={() => {}}
                  />
                </ServiceLink>
              )}
              {event.metadata.service_name && !onNavigateToService && (
                <ServiceBadge
                  serviceName={event.metadata.service_name}
                  tags={event.metadata.tags}
                />
              )}
              <EventKindBadge eventKind={event.kind} />
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
