import { type Event, type CriticalPathData, type AnomaliesData } from '../types';
import { TraceHealth } from './TraceHealth';
import { DashboardStats } from './DashboardStats';
import { TraceInsights } from './TraceInsights';
import { Button } from './ui/button';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';

interface OverviewTabProps {
  events: Event[];
  criticalPathData: CriticalPathData | null;
  anomaliesData: AnomaliesData | null;
  raceCount: number;
  onViewEvents: () => void;
  onNavigate?: (tab: string) => void;
}

export function OverviewTab({
  events,
  criticalPathData,
  anomaliesData,
  raceCount,
  onViewEvents,
  onNavigate,
}: OverviewTabProps) {
  const criticalPathPercentage = criticalPathData?.percentage_of_total || 0;
  const anomalyCount = anomaliesData?.anomaly_count || 0;

  return (
    <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-3">
      <div className="space-y-4">
      {/* Health Score */}
      <TraceHealth
        raceCount={raceCount}
        anomalyCount={anomalyCount}
        criticalPathPercentage={criticalPathPercentage}
      />

      {/* Dashboard Stats */}
      <DashboardStats
        events={events}
        criticalPathData={criticalPathData}
        anomaliesData={anomaliesData}
        raceCount={raceCount}
        onNavigate={onNavigate}
      />

      {/* Trace Insights */}
      <TraceInsights
        events={events}
        criticalPathData={criticalPathData}
        anomaliesData={anomaliesData}
        raceCount={raceCount}
        onNavigate={onNavigate}
      />

      {/* Quick Actions */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {/* Race Conditions Card */}
        <Card className={raceCount > 0 ? "border-red-500/50" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium flex items-center gap-1.5">
              <span>Race Conditions</span>
              {raceCount > 0 && <span className="text-red-400 text-sm">⚠️</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            {raceCount > 0 ? (
              <div className="space-y-2">
                <div className="text-2xl font-bold text-red-400 font-mono">{raceCount}</div>
                <p className="text-xs text-muted-foreground leading-tight">
                  Concurrent state modifications detected that may cause data corruption. View details in the Analysis panel.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-2xl font-bold text-green-400">✓</div>
                <p className="text-xs text-muted-foreground leading-tight">
                  No race conditions detected. All state changes appear properly synchronized.
                </p>
              </div>
            )}
          </CardContent>
        </Card>

        {/* Anomalies Card */}
        <Card className={anomalyCount > 0 ? "border-orange-500/50" : ""}>
          <CardHeader className="pb-2">
            <CardTitle className="text-xs font-medium flex items-center gap-1.5">
              <span>Performance Anomalies</span>
              {anomalyCount > 0 && <span className="text-orange-400 text-sm">⚠</span>}
            </CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            {anomalyCount > 0 ? (
              <div className="space-y-2">
                <div className="text-2xl font-bold text-orange-400 font-mono">{anomalyCount}</div>
                <p className="text-xs text-muted-foreground leading-tight">
                  Operations taking significantly longer than expected. View details in the Analysis panel.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="text-2xl font-bold text-green-400">✓</div>
                <p className="text-xs text-muted-foreground leading-tight">
                  All operations completed within expected time ranges.
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Quick Navigation */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Quick Navigation</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-2 md:grid-cols-2 gap-2">
            <Button onClick={onViewEvents} variant="outline" size="sm" className="justify-start">
              📋 View All Events
            </Button>
            <Button onClick={() => {}} variant="outline" size="sm" className="justify-start">
              📊 Timeline View
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Helpful Tips */}
      {raceCount === 0 && anomalyCount === 0 && (
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <span className="text-2xl">💡</span>
              <div className="space-y-1">
                <div className="font-medium text-sm">This trace looks healthy!</div>
                <p className="text-sm text-muted-foreground">
                  No race conditions or performance anomalies detected. You can explore the event timeline
                  to understand the execution flow, or check the critical path to identify potential optimizations.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
