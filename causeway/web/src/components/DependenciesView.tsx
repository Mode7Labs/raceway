import { type DependenciesData } from '../types';

interface DependenciesViewProps {
  data: DependenciesData | null;
}

export function DependenciesView({ data }: DependenciesViewProps) {
  if (!data) {
    return (
      <div className="loading-state">
        <p>Loading dependencies data...</p>
      </div>
    );
  }

  if (data.services.length === 0) {
    return (
      <div className="empty-state">
        <h3>No services found</h3>
        <p>This trace doesn't contain any service information.</p>
      </div>
    );
  }

  // Sort services by event count (descending)
  const sortedServices = [...data.services].sort((a, b) => b.event_count - a.event_count);

  return (
    <div className="dependencies-view">
      <div className="dependencies-summary">
        <h3>Service Dependencies</h3>
        <div className="summary-stats">
          <div className="stat">
            <span className="stat-label">Total Services:</span>
            <span className="stat-value">{data.services.length}</span>
          </div>
          <div className="stat">
            <span className="stat-label">Cross-Service Calls:</span>
            <span className="stat-value">{data.dependencies.length}</span>
          </div>
        </div>
      </div>

      <div className="services-list">
        <h3>Services</h3>
        {sortedServices.map((service) => (
          <div key={service.name} className="service-item">
            <span className="service-icon">🔹</span>
            <span className="service-name">{service.name}</span>
            <span className="service-count">({service.event_count} events)</span>
          </div>
        ))}
      </div>

      {data.dependencies.length > 0 ? (
        <div className="dependencies-list">
          <h3>Call Graph</h3>
          {data.dependencies.map((dep, idx) => (
            <div key={idx} className="dependency-item">
              <span className="dep-from">{dep.from}</span>
              <span className="dep-arrow">─[{dep.call_count}]→</span>
              <span className="dep-to">{dep.to}</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="dependencies-list">
          <h3>Call Graph</h3>
          <div className="empty-state">
            <p>✓ No cross-service dependencies</p>
            <p className="hint">All events are within the same service</p>
          </div>
        </div>
      )}
    </div>
  );
}
