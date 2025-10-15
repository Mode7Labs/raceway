import { type Event, type CriticalPathData, type AnomaliesData, type DependenciesData } from '../types';

export interface ExportData {
  trace_id: string;
  exported_at: string;
  summary: {
    total_events: number;
    race_conditions: number;
    anomalies: number;
    critical_path_percentage: number;
    duration_ms: number;
  };
  events: Event[];
  critical_path?: CriticalPathData;
  anomalies?: AnomaliesData;
  dependencies?: DependenciesData;
}

export function exportToJSON(
  traceId: string,
  events: Event[],
  criticalPathData: CriticalPathData | null,
  anomaliesData: AnomaliesData | null,
  dependenciesData: DependenciesData | null,
  raceCount: number
): void {
  const exportData: ExportData = {
    trace_id: traceId,
    exported_at: new Date().toISOString(),
    summary: {
      total_events: events.length,
      race_conditions: raceCount,
      anomalies: anomaliesData?.anomaly_count || 0,
      critical_path_percentage: criticalPathData?.percentage_of_total || 0,
      duration_ms: criticalPathData?.trace_total_duration_ms || 0,
    },
    events,
    ...(criticalPathData && { critical_path: criticalPathData }),
    ...(anomaliesData && { anomalies: anomaliesData }),
    ...(dependenciesData && { dependencies: dependenciesData }),
  };

  const blob = new Blob([JSON.stringify(exportData, null, 2)], {
    type: 'application/json',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `trace-${traceId}-${Date.now()}.json`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportToCSV(events: Event[]): void {
  const headers = [
    'ID',
    'Timestamp',
    'Kind',
    'Thread ID',
    'Service Name',
    'Environment',
    'Location',
  ];

  const rows = events.map(event => {
    const kind = typeof event.kind === 'string' ? event.kind : Object.keys(event.kind)[0];
    return [
      event.id,
      event.timestamp,
      kind,
      event.metadata.thread_id,
      event.metadata.service_name,
      event.metadata.environment,
      event.metadata.location,
    ];
  });

  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
  ].join('\n');

  const blob = new Blob([csvContent], { type: 'text/csv' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `trace-events-${Date.now()}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportCriticalPathToMarkdown(
  criticalPathData: CriticalPathData,
  traceId: string
): void {
  const lines = [
    `# Critical Path Analysis`,
    ``,
    `**Trace ID:** ${traceId}`,
    `**Generated:** ${new Date().toISOString()}`,
    ``,
    `## Summary`,
    ``,
    `- **Path Events:** ${criticalPathData.path_events}`,
    `- **Path Duration:** ${criticalPathData.total_duration_ms.toFixed(2)} ms`,
    `- **Total Duration:** ${criticalPathData.trace_total_duration_ms.toFixed(2)} ms`,
    `- **Percentage:** ${criticalPathData.percentage_of_total.toFixed(2)}%`,
    ``,
    `## Critical Path Events`,
    ``,
    ...criticalPathData.path.map((event, idx) => {
      return [
        `### ${idx + 1}. ${event.kind}`,
        ``,
        `- **ID:** ${event.id}`,
        `- **Timestamp:** ${event.timestamp}`,
        `- **Duration:** ${event.duration_ms.toFixed(2)} ms`,
        `- **Location:** ${event.location}`,
        ``,
      ].join('\n');
    }),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `critical-path-${traceId}-${Date.now()}.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportAnomaliesToMarkdown(
  anomaliesData: AnomaliesData,
  traceId: string
): void {
  const lines = [
    `# Anomalies Report`,
    ``,
    `**Trace ID:** ${traceId}`,
    `**Generated:** ${new Date().toISOString()}`,
    ``,
    `## Summary`,
    ``,
    `- **Total Anomalies:** ${anomaliesData.anomaly_count}`,
    `- **Critical:** ${anomaliesData.anomalies.filter(a => a.severity === 'Critical').length}`,
    `- **Warning:** ${anomaliesData.anomalies.filter(a => a.severity === 'Warning').length}`,
    `- **Minor:** ${anomaliesData.anomalies.filter(a => a.severity === 'Minor').length}`,
    ``,
    `## Detected Anomalies`,
    ``,
    ...anomaliesData.anomalies.map((anomaly, idx) => {
      return [
        `### ${idx + 1}. ${anomaly.event_kind} [${anomaly.severity}]`,
        ``,
        `${anomaly.description}`,
        ``,
        `- **Event ID:** ${anomaly.event_id}`,
        `- **Timestamp:** ${anomaly.timestamp}`,
        `- **Actual Duration:** ${anomaly.actual_duration_ms.toFixed(2)} ms`,
        `- **Expected Duration:** ${anomaly.expected_duration_ms.toFixed(2)} ms`,
        `- **Standard Deviations:** ${anomaly.std_dev_from_mean.toFixed(2)}σ`,
        `- **Location:** ${anomaly.location}`,
        ``,
      ].join('\n');
    }),
  ];

  const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `anomalies-${traceId}-${Date.now()}.md`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
