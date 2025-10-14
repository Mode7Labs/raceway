import { useState } from 'react';
import { type AuditTrailData } from '../types';

interface AuditTrailViewProps {
  data: AuditTrailData | null;
  onVariableChange: (variable: string) => void;
}

export function AuditTrailView({ data, onVariableChange }: AuditTrailViewProps) {
  const [inputVariable, setInputVariable] = useState('');

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputVariable.trim()) {
      onVariableChange(inputVariable.trim());
    }
  };

  return (
    <div className="audit-trail-view">
      <div className="audit-trail-search">
        <h3>Variable Inspector</h3>
        <form onSubmit={handleSearch} className="search-form">
          <input
            type="text"
            value={inputVariable}
            onChange={(e) => setInputVariable(e.target.value)}
            placeholder="Enter variable name (e.g., order_status)"
            className="variable-input"
          />
          <button type="submit">Track Variable</button>
        </form>
      </div>

      {!data ? (
        <div className="empty-state">
          <h3>No variable selected</h3>
          <p>Enter a variable name above to view its audit trail</p>
        </div>
      ) : data.accesses.length === 0 ? (
        <div className="empty-state">
          <h3>No accesses found</h3>
          <p>Variable "{data.variable}" was not accessed in this trace</p>
        </div>
      ) : (
        <>
          <div className="audit-trail-summary">
            <h3>Audit Trail: {data.variable}</h3>
            <div className="summary-stats">
              <div className="stat">
                <span className="stat-label">Total Accesses:</span>
                <span className="stat-value">{data.accesses.length}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Race Conditions:</span>
                <span className="stat-value stat-races">
                  {data.accesses.filter(a => a.is_race).length}
                </span>
              </div>
            </div>
          </div>

          <div className="audit-trail-timeline">
            {data.accesses.map((access, idx) => (
              <div key={idx} className="audit-trail-item">
                <div className="timeline-marker">
                  {access.is_race && <span className="race-indicator">⚠️</span>}
                </div>

                <div className={`access-card ${access.is_race ? 'race' : ''}`}>
                  <div className="access-header">
                    <span className={`access-type ${access.access_type.toLowerCase()}`}>
                      {access.access_type}
                    </span>
                    <span className="access-time">
                      {new Date(access.timestamp).toLocaleTimeString('en-US', {
                        hour12: false,
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                        fractionalSecondDigits: 3
                      })}
                    </span>
                  </div>

                  <div className="access-details">
                    <div className="detail-row">
                      <span className="detail-label">Service:</span>
                      <span className="detail-value">{access.service_name}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Thread:</span>
                      <span className="detail-value">{access.thread_id}</span>
                    </div>
                    <div className="detail-row">
                      <span className="detail-label">Location:</span>
                      <span className="detail-value location">{access.location}</span>
                    </div>
                    <div className="detail-row value-change">
                      {access.old_value !== null && (
                        <>
                          <span className="old-value">{JSON.stringify(access.old_value)}</span>
                          <span className="arrow">→</span>
                        </>
                      )}
                      <span className="new-value">{JSON.stringify(access.new_value)}</span>
                    </div>
                  </div>

                  {access.is_race && (
                    <div className="race-warning">
                      <strong>⚠️ RACE CONDITION</strong> - No causal link to previous access
                    </div>
                  )}

                  {!access.has_causal_link_to_previous && idx > 0 && !access.is_race && (
                    <div className="causal-warning">
                      ℹ️ No direct causal link to previous access
                    </div>
                  )}
                </div>

                {idx < data.accesses.length - 1 && (
                  <div className="timeline-connector">
                    {data.accesses[idx + 1].has_causal_link_to_previous ? (
                      <div className="causal-link">↓ Causal influence</div>
                    ) : (
                      <div className="no-causal-link">⋮ Concurrent</div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
