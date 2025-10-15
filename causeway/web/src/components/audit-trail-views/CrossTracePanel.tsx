import { useState, useEffect } from 'react';
import { type GlobalRaceDetail } from '../../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';
import { AlertTriangle, ExternalLink } from 'lucide-react';

interface CrossTracePanelProps {
  variable: string;
  currentTraceId: string;
  apiBaseUrl: string;
  onTraceSelect?: (traceId: string) => void;
}

export function CrossTracePanel({ variable, currentTraceId, apiBaseUrl, onTraceSelect }: CrossTracePanelProps) {
  const [loading, setLoading] = useState(true);
  const [crossTraceRaces, setCrossTraceRaces] = useState<GlobalRaceDetail[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchGlobalRaces = async () => {
      setLoading(true);
      setError(null);

      try {
        const response = await fetch(`${apiBaseUrl}/api/analyze/global`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const result = await response.json();
        if (result.success && result.data && result.data.race_details) {
          // Filter to only races involving this variable
          const relevantRaces = result.data.race_details.filter(
            (race: GlobalRaceDetail) => race.variable === variable
          );

          // Filter to races involving the current trace
          const crossTraceRaces = relevantRaces.filter(
            (race: GlobalRaceDetail) =>
              race.trace1_id === currentTraceId || race.trace2_id === currentTraceId
          );

          setCrossTraceRaces(crossTraceRaces);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch global races');
      } finally {
        setLoading(false);
      }
    };

    fetchGlobalRaces();
  }, [variable, currentTraceId, apiBaseUrl]);

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      if (isNaN(date.getTime())) {
        return timestamp;
      }
      const hours = date.getHours().toString().padStart(2, '0');
      const minutes = date.getMinutes().toString().padStart(2, '0');
      const seconds = date.getSeconds().toString().padStart(2, '0');
      const ms = date.getMilliseconds().toString().padStart(3, '0');
      return `${hours}:${minutes}:${seconds}.${ms}`;
    } catch {
      return timestamp;
    }
  };

  const getSeverityColor = (severity: string) => {
    switch (severity.toUpperCase()) {
      case 'CRITICAL':
        return 'text-red-400 border-red-500/30';
      case 'WARNING':
        return 'text-yellow-400 border-yellow-500/30';
      default:
        return 'text-blue-400 border-blue-500/30';
    }
  };

  if (loading) {
    return (
      <Card className="bg-muted/30">
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs font-semibold">CROSS-TRACE ACTIVITY</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0 text-xs text-muted-foreground">
          Loading cross-trace data...
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="bg-muted/30 border-destructive/50">
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs font-semibold text-destructive">CROSS-TRACE ACTIVITY</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0 text-xs text-destructive">
          Error: {error}
        </CardContent>
      </Card>
    );
  }

  if (crossTraceRaces.length === 0) {
    return (
      <Card className="bg-muted/30">
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs font-semibold">CROSS-TRACE ACTIVITY</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0 text-xs text-muted-foreground">
          No concurrent accesses from other traces detected
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-destructive/10 border-destructive/50">
      <CardHeader className="pb-2 pt-3 px-3">
        <CardTitle className="text-xs font-semibold flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-destructive" />
          CROSS-TRACE RACES ({crossTraceRaces.length})
        </CardTitle>
      </CardHeader>
      <CardContent className="px-3 pb-3 pt-0 space-y-2 text-[11px]">
        {crossTraceRaces.map((race, idx) => {
          const otherTraceId = race.trace1_id === currentTraceId ? race.trace2_id : race.trace1_id;
          const currentTraceInfo = race.trace1_id === currentTraceId
            ? { location: race.event1_location, thread: race.event1_thread, timestamp: race.event1_timestamp }
            : { location: race.event2_location, thread: race.event2_thread, timestamp: race.event2_timestamp };
          const otherTraceInfo = race.trace1_id === currentTraceId
            ? { location: race.event2_location, thread: race.event2_thread, timestamp: race.event2_timestamp }
            : { location: race.event1_location, thread: race.event1_thread, timestamp: race.event1_timestamp };

          return (
            <div
              key={idx}
              className="bg-muted/50 rounded p-2 space-y-1 border-l-2 border-l-destructive"
            >
              <div className="flex items-center justify-between">
                <Badge variant="outline" className={cn("text-[9px]", getSeverityColor(race.severity))}>
                  {race.severity}
                </Badge>
                <div className="text-[10px] text-muted-foreground">
                  Variable: <span className="text-primary font-mono">{race.variable}</span>
                </div>
              </div>

              <div className="space-y-0.5 pl-1">
                <div className="text-muted-foreground">
                  <span className="text-cyan-400">This trace:</span>
                </div>
                <div className="pl-2 space-y-0.5">
                  <div>Thread: <span className="text-blue-400">{currentTraceInfo.thread}</span></div>
                  <div>Location: <span className="text-foreground">{currentTraceInfo.location}</span></div>
                  <div>Time: <span className="text-amber-400">{formatTimestamp(currentTraceInfo.timestamp)}</span></div>
                </div>

                <div className="text-muted-foreground mt-1">
                  <span className="text-orange-400">Conflicting trace:</span>
                </div>
                <div className="pl-2 space-y-0.5">
                  <div className="flex items-center gap-1">
                    Trace: <span className="text-purple-400 font-mono">{otherTraceId.substring(0, 8)}</span>
                    {onTraceSelect && (
                      <button
                        onClick={() => onTraceSelect(otherTraceId)}
                        className="text-blue-400 hover:text-blue-300 transition-colors"
                        title="View this trace"
                      >
                        <ExternalLink className="h-3 w-3" />
                      </button>
                    )}
                  </div>
                  <div>Thread: <span className="text-blue-400">{otherTraceInfo.thread}</span></div>
                  <div>Location: <span className="text-foreground">{otherTraceInfo.location}</span></div>
                  <div>Time: <span className="text-amber-400">{formatTimestamp(otherTraceInfo.timestamp)}</span></div>
                </div>
              </div>

              <div className="text-[10px] text-muted-foreground italic pt-1 border-t border-border/30">
                {race.description}
              </div>
            </div>
          );
        })}
      </CardContent>
    </Card>
  );
}
