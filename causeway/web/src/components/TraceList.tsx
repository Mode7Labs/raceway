interface TraceListProps {
  traces: string[];
  selectedTraceId: string | null;
  tracesWithRaces: Set<string>;
  onSelect: (traceId: string) => void;
}

export function TraceList({ traces, selectedTraceId, tracesWithRaces, onSelect }: TraceListProps) {
  return (
    <div className="traces-panel">
      <div className="panel-header">
        Traces ({traces.length})
      </div>
      <div className="traces-list">
        {traces.map((traceId) => {
          const hasRaces = tracesWithRaces.has(traceId);
          const isSelected = traceId === selectedTraceId;

          return (
            <div
              key={traceId}
              className={`trace-item ${isSelected ? 'selected' : ''} ${hasRaces ? 'has-races' : ''}`}
              onClick={() => onSelect(traceId)}
            >
              <span className="trace-icon">
                {hasRaces ? '⚠️' : '📋'}
              </span>
              <span className="trace-id" title={traceId}>
                {traceId.substring(0, 8)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
