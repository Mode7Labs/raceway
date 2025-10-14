import { type AnomaliesData } from '../types';

interface AnomaliesViewProps {
  data: AnomaliesData | null;
}

export function AnomaliesView({ data }: AnomaliesViewProps) {
  if (!data) {
    return (
      <div className="loading-state">
        <p>Loading anomalies data...</p>
      </div>
    );
  }

  if (data.anomaly_count === 0) {
    return (
      <div className="empty-state">
        <h3>No anomalies detected</h3>
        <p>All events in this trace appear to be within normal performance ranges.</p>
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

  const getSeverityClass = (severity: string): string => {
    switch (severity.toLowerCase()) {
      case 'critical':
        return 'severity-critical';
      case 'warning':
        return 'severity-warning';
      case 'minor':
        return 'severity-minor';
      default:
        return '';
    }
  };

  return (
    <div className="anomalies-view">
      <div className="anomalies-summary">
        <h3>Anomalies Detected: {data.anomaly_count}</h3>
      </div>

      <div className="anomalies-list">
        {data.anomalies.map((anomaly) => (
          <div key={anomaly.event_id} className={`anomaly-item ${getSeverityClass(anomaly.severity)}`}>
            <div className="anomaly-header">
              <span className={`severity-badge ${getSeverityClass(anomaly.severity)}`}>
                {anomaly.severity}
              </span>
              <span className="anomaly-kind">{anomaly.event_kind}</span>
              <span className="anomaly-timestamp">[{formatTimestamp(anomaly.timestamp)}]</span>
            </div>

            <div className="anomaly-stats">
              <div className="stat">
                <span className="stat-label">Actual:</span>
                <span className="stat-value">{anomaly.actual_duration_ms.toFixed(2)} ms</span>
              </div>
              <div className="stat">
                <span className="stat-label">Expected:</span>
                <span className="stat-value">{anomaly.expected_duration_ms.toFixed(2)} ms</span>
              </div>
              <div className="stat">
                <span className="stat-label">Deviation:</span>
                <span className="stat-value">{anomaly.std_dev_from_mean.toFixed(2)}σ</span>
              </div>
            </div>

            <div className="anomaly-description">{anomaly.description}</div>
            <div className="anomaly-location">{anomaly.location}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
