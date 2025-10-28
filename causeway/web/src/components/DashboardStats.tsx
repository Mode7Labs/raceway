import {
  type Event,
  type CriticalPathData,
  type AnomaliesData,
} from "../types";
import { Card, CardContent } from "./ui/card";

interface DashboardStatsProps {
  events: Event[];
  criticalPathData: CriticalPathData | null;
  anomaliesData: AnomaliesData | null;
  raceCount: number;
  onNavigate?: (tab: string) => void;
}

export function DashboardStats({
  events,
  criticalPathData,
  anomaliesData,
  raceCount,
  onNavigate,
}: DashboardStatsProps) {
  if (events.length === 0) {
    return null;
  }

  // Calculate stats
  const uniqueServices = new Set(events.map((e) => e.metadata.service_name)).size;
  const isDistributed = uniqueServices > 1;
  const traceDuration = criticalPathData?.trace_total_duration_ms || 0;
  const criticalPathPercentage = criticalPathData?.percentage_of_total || 0;

  // Count event types
  const eventTypeCounts = events.reduce((acc, event) => {
    const kind =
      typeof event.kind === "string"
        ? event.kind
        : Object.keys(event.kind)[0] || "Unknown";
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const statCards = [
    {
      label: "Total Events",
      value: events.length.toLocaleString(),
      color: "text-blue-400",
      tooltip: "Total number of captured events in this trace",
      navigateTo: "events",
    },
    ...(isDistributed
      ? [
          {
            label: "Services",
            value: uniqueServices.toString(),
            color: "text-cyan-400",
            tooltip: "Number of services involved in this distributed trace",
            navigateTo: "events",
          },
        ]
      : []),
    {
      label: "Trace Duration",
      value: `${traceDuration.toFixed(2)}ms`,
      color: "text-cyan-400",
      tooltip: "Total execution time from first to last event",
      navigateTo: "performance",
    },
    {
      label: "Critical Path",
      value: `${criticalPathPercentage.toFixed(1)}%`,
      color:
        criticalPathPercentage > 70
          ? "text-orange-400"
          : criticalPathPercentage > 50
          ? "text-cyan-400"
          : "text-green-400",
      tooltip:
        criticalPathPercentage > 70
          ? "High critical path indicates potential bottleneck"
          : "Percentage of total duration spent in critical path",
      navigateTo: "performance",
    },
    {
      label: "Anomalies",
      value: (anomaliesData?.anomaly_count ?? 0).toString(),
      color:
        (anomaliesData?.anomaly_count ?? 0) > 0
          ? "text-orange-400"
          : "text-green-400",
      tooltip:
        (anomaliesData?.anomaly_count ?? 0) > 0
          ? "Operations taking longer than expected"
          : "No performance anomalies detected",
      navigateTo: "anomalies",
    },
    {
      label: "Potential Races",
      value: raceCount.toString(),
      color: raceCount > 0 ? "text-red-400" : "text-green-400",
      tooltip:
        raceCount > 0
          ? "Concurrent state modifications detected!"
          : "No race conditions detected",
      navigateTo: "events",
    },
  ];

  return (
    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 mb-4">
      {statCards.map((stat) => (
        <Card
          key={stat.label}
          className="bg-card/50 border-border/50 cursor-pointer hover:bg-card/70 transition-colors"
          title={stat.tooltip}
          onClick={() => onNavigate?.(stat.navigateTo)}
        >
          <CardContent className="p-3">
            <div className="text-[10px] text-muted-foreground uppercase tracking-wide mb-1">
              {stat.label}
            </div>
            <div className={`text-sm font-medium font-mono ${stat.color}`}>
              {stat.value}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
