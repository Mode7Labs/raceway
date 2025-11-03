import { Card, CardContent } from '@/components/ui/card';
import type { ServiceListItem } from '@/types';

interface ServiceOverviewProps {
  service: ServiceListItem;
  loading?: boolean;
}

export function ServiceOverview({ service, loading }: ServiceOverviewProps) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading service data...</div>
      </div>
    );
  }

  const avgEventsPerTrace =
    service.trace_count > 0 ? (service.event_count / service.trace_count).toFixed(1) : '0';

  const stats = [
    {
      label: 'Total Events',
      value: service.event_count.toLocaleString(),
      color: 'text-cyan-400',
      description: 'Total events from this service',
    },
    {
      label: 'Total Traces',
      value: service.trace_count.toLocaleString(),
      color: 'text-purple-400',
      description: 'Traces involving this service',
    },
    {
      label: 'Avg Events/Trace',
      value: avgEventsPerTrace,
      color: 'text-green-400',
      description: 'Average events per trace',
    },
  ];

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold mb-2">{service.name}</h2>
        <p className="text-sm text-muted-foreground">Service metrics and details</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {stats.map((stat) => (
          <Card key={stat.label} className="bg-card/50 border-border/50">
            <CardContent className="p-4">
              <div className="text-xs text-muted-foreground uppercase tracking-wide mb-1">
                {stat.label}
              </div>
              <div className={`text-2xl font-bold font-mono ${stat.color} mb-1`}>
                {stat.value}
              </div>
              <div className="text-xs text-muted-foreground">{stat.description}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Service details card */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Service Details</h3>
          <div className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Service Name:</span>
              <span className="font-mono text-foreground/90">{service.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Event Count:</span>
              <span className="font-mono text-cyan-400">
                {service.event_count.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Trace Count:</span>
              <span className="font-mono text-purple-400">
                {service.trace_count.toLocaleString()}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Avg Events per Trace:</span>
              <span className="font-mono text-green-400">{avgEventsPerTrace}</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Quick Actions */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Quick Actions</h3>
          <div className="text-xs text-muted-foreground">
            Use the tabs above to:
            <ul className="list-disc list-inside mt-2 space-y-1">
              <li>View all traces involving this service</li>
              <li>Analyze service dependencies (upstream/downstream)</li>
              <li>Monitor performance metrics and anomalies</li>
            </ul>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
