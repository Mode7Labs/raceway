import { type Event } from '../types';

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
    <div className="events-list">
      {events.map((event) => {
        const isSelected = event.id === selectedEventId;
        const eventKind = getEventKind(event.kind);
        const timestamp = formatTimestamp(event.timestamp);

        return (
          <div
            key={event.id}
            className={`event-item ${isSelected ? 'selected' : ''}`}
            onClick={() => onEventSelect(event.id)}
          >
            <span className="event-timestamp">[{timestamp}]</span>
            <span className="event-kind">{eventKind}</span>
            <span className="event-thread">Thread: {event.metadata.thread_id}</span>
          </div>
        );
      })}
    </div>
  );
}
