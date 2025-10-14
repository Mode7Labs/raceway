import { type CriticalPathData } from '../types';

interface CriticalPathViewProps {
  data: CriticalPathData | null;
}

export function CriticalPathView({ data }: CriticalPathViewProps) {
  if (!data) {
    return (
      <div className="loading-state">
        <p>Loading critical path data...</p>
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

  return (
    <div className="critical-path-view">
      <div className="critical-path-summary">
        <h3>Critical Path Summary</h3>
        <div className="summary-stats">
          <div className="stat">
            <span className="stat-label">Path Events:</span>
            <span className="stat-value">{data.path_events}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Path Duration:</span>
            <span className="stat-value">{data.total_duration_ms.toFixed(2)} ms</span>
          </div>
          <div className="stat">
            <span className="stat-label">Total Duration:</span>
            <span className="stat-value">{data.trace_total_duration_ms.toFixed(2)} ms</span>
          </div>
          <div className="stat">
            <span className="stat-label">Percentage:</span>
            <span className="stat-value">{data.percentage_of_total.toFixed(1)}%</span>
          </div>
        </div>
      </div>

      <div className="critical-path-events">
        <h3>Critical Path Events</h3>
        {data.path.map((pathEvent, idx) => (
          <div key={pathEvent.id} className="path-event">
            <span className="path-event-index">{idx + 1}.</span>
            <span className="path-event-timestamp">[{formatTimestamp(pathEvent.timestamp)}]</span>
            <span className="path-event-kind">{pathEvent.kind}</span>
            <span className="path-event-duration">{pathEvent.duration_ms.toFixed(2)} ms</span>
            <span className="path-event-location">{pathEvent.location}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
