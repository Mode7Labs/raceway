interface RaceConditionsProps {
  anomalies: string[];
}

export function RaceConditions({ anomalies }: RaceConditionsProps) {
  if (anomalies.length === 0) {
    return (
      <div className="empty-state">
        <p>No race conditions detected</p>
      </div>
    );
  }

  return (
    <div className="race-conditions">
      {anomalies.map((anomaly, idx) => (
        <div key={idx} className="race-item">
          <span className="race-icon">⚠️</span>
          <span className="race-text">{anomaly}</span>
        </div>
      ))}
    </div>
  );
}
