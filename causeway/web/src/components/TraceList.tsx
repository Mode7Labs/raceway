import { cn } from '@/lib/utils';

interface TraceListProps {
  traces: string[];
  selectedTraceId: string | null;
  tracesWithRaces: Set<string>;
  traceRaceCounts: Map<string, number>;
  onSelect: (traceId: string) => void;
}

export function TraceList({ traces, selectedTraceId, tracesWithRaces, traceRaceCounts, onSelect }: TraceListProps) {

  const getTraceHealthColor = (traceId: string) => {
    const raceCount = traceRaceCounts.get(traceId) || 0;

    // Calculate a simple health score
    let score = 100;
    score -= raceCount * 20;

    // Return color based on score
    if (score >= 90) return 'bg-green-500'; // Excellent/Good - Green
    if (score >= 50) return 'bg-orange-500'; // Warning - Orange
    return 'bg-red-500 animate-pulse'; // Critical - Red with pulse
  };

  return (
    <div className="space-y-1">
      {traces.map((traceId) => {
        const isSelected = traceId === selectedTraceId;
        const healthColor = getTraceHealthColor(traceId);

        return (
          <button
            key={traceId}
            onClick={() => onSelect(traceId)}
            className={cn(
              "w-full flex items-center justify-between gap-2 px-2.5 py-2 rounded-md text-xs font-mono transition-all cursor-pointer",
              "hover:bg-accent/50",
              isSelected ? "bg-muted" : "bg-card/50"
            )}
            title={traceId}
          >
            <div className="flex items-center gap-2 min-w-0">
              <div className="relative flex-shrink-0">
                <div className={cn("w-2 h-2 rounded-full", healthColor)} />
              </div>
              <span className="truncate">
                {traceId.substring(0, 8)}
              </span>
            </div>
            <div className="flex items-center gap-1.5">
              {isSelected && (
                <svg className="w-3 h-3 flex-shrink-0 text-primary" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                  <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
