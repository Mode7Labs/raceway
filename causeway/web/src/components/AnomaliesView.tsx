import { type AnomaliesData } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { cn } from '@/lib/utils';
import { getEventKindColor } from '@/lib/event-colors';

interface AnomaliesViewProps {
  data: AnomaliesData | null;
  raceInfo?: string[];
}

export function AnomaliesView({ data, raceInfo = [] }: AnomaliesViewProps) {
  if (!data) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        Loading anomalies data...
      </div>
    );
  }

  // Group race info lines into actual race conditions
  const groupedRaces: string[][] = [];
  let currentGroup: string[] = [];

  raceInfo.forEach((line) => {
    const cleanedLine = line.replace(/^⚠️\s*/, '');

    // Start of a new race condition (lines starting with "Found" or "WARNING RACE" or emoji flag)
    if (cleanedLine.startsWith('Found ') || cleanedLine.startsWith('🚨') || cleanedLine.startsWith('WARNING RACE')) {
      if (currentGroup.length > 0) {
        groupedRaces.push(currentGroup);
      }
      currentGroup = [cleanedLine];
    } else if (cleanedLine.trim().length > 0) {
      // Add to current group if it's not empty
      currentGroup.push(cleanedLine);
    } else if (currentGroup.length > 0) {
      // Empty line signals end of a group
      groupedRaces.push(currentGroup);
      currentGroup = [];
    }
  });

  // Don't forget the last group
  if (currentGroup.length > 0) {
    groupedRaces.push(currentGroup);
  }

  const hasRaces = groupedRaces.length > 0;
  const hasAnomalies = data.anomaly_count > 0;

  if (!hasRaces && !hasAnomalies) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-3">
        <div className="text-5xl">✓</div>
        <h3 className="text-lg font-semibold text-green-400">All Clear!</h3>
        <p className="text-sm text-muted-foreground max-w-md">
          No race conditions or performance anomalies detected. All events appear to be
          properly synchronized and executing within expected performance ranges.
        </p>
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

  const getSeverityVariant = (severity: string): 'default' | 'secondary' | 'destructive' => {
    switch (severity.toLowerCase()) {
      case 'critical':
        return 'destructive';
      case 'warning':
        return 'default';
      default:
        return 'secondary';
    }
  };

  return (
    <div className="space-y-6">
      {/* Race Conditions Section */}
      {hasRaces && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold text-red-400">Race Conditions Detected</h3>
            <Badge variant="destructive" className="text-base">
              {groupedRaces.length}
            </Badge>
          </div>
          <Card className="border-red-500/50 bg-red-500/5">
            <CardHeader>
              <CardTitle className="text-sm text-red-400">Critical Issues</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {groupedRaces.map((raceGroup, idx) => {
                return (
                  <div key={idx} className="p-3 rounded-lg border border-red-500/30 bg-red-500/10">
                    <pre className="text-xs leading-relaxed whitespace-pre-wrap font-mono">
                      {raceGroup.join('\n')}
                    </pre>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        </div>
      )}

      {/* Performance Anomalies Section */}
      {hasAnomalies && (
        <div className="space-y-4">
          <div className="flex items-center gap-2">
            <h3 className="text-lg font-semibold">Performance Anomalies:</h3>
            <Badge variant="default" className="text-base">
              {data.anomaly_count}
            </Badge>
          </div>

          <div className="space-y-4">
        {data.anomalies.map((anomaly) => (
          <Card key={anomaly.event_id} className="border-l-4 border-l-destructive">
            <CardHeader className="pb-3">
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={getSeverityVariant(anomaly.severity)} className="text-[10px]">
                  {anomaly.severity}
                </Badge>
                <span className={cn("font-mono text-xs", getEventKindColor(anomaly.event_kind))}>
                  {anomaly.event_kind}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground">
                  [{formatTimestamp(anomaly.timestamp)}]
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div className="space-y-1">
                  <div className="text-muted-foreground text-xs">Actual</div>
                  <div className="font-mono font-semibold">{anomaly.actual_duration_ms.toFixed(2)} ms</div>
                </div>
                <div className="space-y-1">
                  <div className="text-muted-foreground text-xs">Expected</div>
                  <div className="font-mono">{anomaly.expected_duration_ms.toFixed(2)} ms</div>
                </div>
                <div className="space-y-1">
                  <div className="text-muted-foreground text-xs">Deviation</div>
                  <div className="font-mono text-destructive">{anomaly.std_dev_from_mean.toFixed(2)}σ</div>
                </div>
              </div>
              <div className="text-sm">{anomaly.description}</div>
              <div className="text-xs text-muted-foreground font-mono">{anomaly.location}</div>
            </CardContent>
          </Card>
        ))}
          </div>
        </div>
      )}
    </div>
  );
}
