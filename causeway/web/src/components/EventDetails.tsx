import { type Event } from '../types';

interface EventDetailsProps {
  event: Event | undefined;
}

export function EventDetails({ event }: EventDetailsProps) {
  if (!event) {
    return (
      <div className="empty-state">
        <p>No event selected</p>
      </div>
    );
  }

  const formatJSON = (obj: any): string => {
    return JSON.stringify(obj, null, 2);
  };

  return (
    <div className="event-details">
      <div className="details-section">
        <h4>Event ID</h4>
        <div className="details-value monospace">{event.id}</div>
      </div>

      <div className="details-section">
        <h4>Trace ID</h4>
        <div className="details-value monospace">{event.trace_id}</div>
      </div>

      {event.parent_id && (
        <div className="details-section">
          <h4>Parent ID</h4>
          <div className="details-value monospace">{event.parent_id}</div>
        </div>
      )}

      <div className="details-section">
        <h4>Timestamp</h4>
        <div className="details-value">{event.timestamp}</div>
      </div>

      <div className="details-section">
        <h4>Kind</h4>
        <pre className="details-json">{formatJSON(event.kind)}</pre>
      </div>

      <div className="details-section">
        <h4>Metadata</h4>
        <pre className="details-json">{formatJSON(event.metadata)}</pre>
      </div>

      <div className="details-section">
        <h4>Causality Vector</h4>
        <pre className="details-json">{formatJSON(event.causality_vector)}</pre>
      </div>

      {event.lock_set.length > 0 && (
        <div className="details-section">
          <h4>Lock Set</h4>
          <pre className="details-json">{formatJSON(event.lock_set)}</pre>
        </div>
      )}
    </div>
  );
}
