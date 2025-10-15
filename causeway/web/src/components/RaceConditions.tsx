import { Badge } from './ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { type AnomaliesData } from '../types';
import { cn } from '@/lib/utils';
import { getEventKindColor } from '@/lib/event-colors';

interface RaceConditionsProps {
  raceInfo: string[];
  anomaliesData: AnomaliesData | null;
}

export function RaceConditions({ raceInfo, anomaliesData }: RaceConditionsProps) {
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
  const hasAnomalies = anomaliesData && anomaliesData.anomaly_count > 0;

  if (!hasRaces && !hasAnomalies) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-center space-y-2">
        <div className="text-3xl">✓</div>
        <h3 className="text-sm font-semibold text-green-400">All Clear!</h3>
        <p className="text-[10px] text-muted-foreground max-w-xs">
          No race conditions or performance anomalies detected.
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
    <div className="space-y-4">
      {/* Race Conditions Section */}
      {hasRaces && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-semibold text-red-400">Race Conditions</h3>
            <Badge variant="destructive" className="text-[9px] h-4">
              {groupedRaces.length}
            </Badge>
          </div>
          <div className="space-y-2">
            {groupedRaces.map((raceGroup, idx) => (
              <div key={idx} className="p-2 rounded border border-red-500/30 bg-red-500/10">
                <pre className="text-[10px] leading-relaxed whitespace-pre-wrap font-mono text-red-400">
                  {raceGroup.join('\n')}
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Performance Anomalies Section */}
      {hasAnomalies && (
        <div className="space-y-2">
          <div className="flex items-center gap-1.5">
            <h3 className="text-xs font-semibold text-orange-400">Performance Anomalies</h3>
            <Badge variant="default" className="text-[9px] h-4 bg-orange-500/10 text-orange-400">
              {anomaliesData.anomaly_count}
            </Badge>
          </div>
          <div className="space-y-2">
            {anomaliesData.anomalies.map((anomaly) => (
              <Card key={anomaly.event_id} className="border-l-2 border-l-orange-500">
                <CardHeader className="pb-2 pt-2 px-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Badge variant={getSeverityVariant(anomaly.severity)} className="text-[9px] h-4">
                      {anomaly.severity}
                    </Badge>
                    <span className={cn("font-mono text-[10px]", getEventKindColor(anomaly.event_kind))}>
                      {anomaly.event_kind}
                    </span>
                    <span className="font-mono text-[9px] text-muted-foreground">
                      [{formatTimestamp(anomaly.timestamp)}]
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2 px-2 pb-2">
                  <div className="grid grid-cols-3 gap-2 text-[10px]">
                    <div className="space-y-0.5">
                      <div className="text-muted-foreground text-[9px]">Actual</div>
                      <div className="font-mono font-semibold">{anomaly.actual_duration_ms.toFixed(1)}ms</div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-muted-foreground text-[9px]">Expected</div>
                      <div className="font-mono">{anomaly.expected_duration_ms.toFixed(1)}ms</div>
                    </div>
                    <div className="space-y-0.5">
                      <div className="text-muted-foreground text-[9px]">Deviation</div>
                      <div className="font-mono text-orange-400">{anomaly.std_dev_from_mean.toFixed(1)}σ</div>
                    </div>
                  </div>
                  <div className="text-[10px]">{anomaly.description}</div>
                  <div className="text-[9px] text-muted-foreground font-mono truncate">{anomaly.location}</div>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
