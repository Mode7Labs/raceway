import { useMemo } from 'react';
import { type Event, type CriticalPathData, type AnomaliesData } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { AlertTriangle, TrendingUp, Clock, Zap } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TraceInsightsProps {
  events: Event[];
  criticalPathData: CriticalPathData | null;
  anomaliesData: AnomaliesData | null;
  raceCount: number;
  onNavigate?: (tab: string) => void;
}

interface Insight {
  id: string;
  type: 'critical' | 'warning' | 'info' | 'success';
  category: 'performance' | 'concurrency' | 'optimization';
  title: string;
  description: string;
  action?: {
    label: string;
    tab: string;
  };
  metric?: string;
}

export function TraceInsights({
  events,
  criticalPathData,
  anomaliesData,
  raceCount,
  onNavigate,
}: TraceInsightsProps) {
  const insights = useMemo(() => {
    const results: Insight[] = [];

    // Race Condition Insights
    if (raceCount > 0) {
      results.push({
        id: 'race-conditions',
        type: 'critical',
        category: 'concurrency',
        title: 'Race Conditions Detected',
        description: `${raceCount} concurrent state modification${raceCount > 1 ? 's' : ''} detected. This can lead to data corruption and unpredictable behavior.`,
        action: {
          label: 'View Debugger',
          tab: 'variables',
        },
        metric: `${raceCount}`,
      });
    }

    // Critical Anomalies
    const criticalAnomalies = anomaliesData?.anomalies?.filter(a => a.severity === 'Critical') ?? [];
    if (criticalAnomalies.length > 0) {
      results.push({
        id: 'critical-anomalies',
        type: 'critical',
        category: 'performance',
        title: 'Critical Performance Issues',
        description: `${criticalAnomalies.length} operation${criticalAnomalies.length > 1 ? 's' : ''} taking significantly longer than expected. Immediate attention required.`,
        action: {
          label: 'View Anomalies',
          tab: 'anomalies',
        },
        metric: `${criticalAnomalies.length}`,
      });
    }

    // High Critical Path Percentage
    if (criticalPathData && criticalPathData.percentage_of_total > 70) {
      results.push({
        id: 'high-critical-path',
        type: 'warning',
        category: 'optimization',
        title: 'High Critical Path Coverage',
        description: `${criticalPathData.percentage_of_total.toFixed(1)}% of execution time is on the critical path. Limited parallelization opportunities.`,
        action: {
          label: 'View Critical Path',
          tab: 'performance',
        },
        metric: `${criticalPathData.percentage_of_total.toFixed(0)}%`,
      });
    }

    // Warning Level Anomalies
    const warningAnomalies = anomaliesData?.anomalies?.filter(a => a.severity === 'Warning') ?? [];
    if (warningAnomalies.length > 0 && criticalAnomalies.length === 0) {
      results.push({
        id: 'warning-anomalies',
        type: 'warning',
        category: 'performance',
        title: 'Performance Degradation',
        description: `${warningAnomalies.length} operation${warningAnomalies.length > 1 ? 's' : ''} showing performance degradation. Consider investigation.`,
        action: {
          label: 'View Anomalies',
          tab: 'anomalies',
        },
        metric: `${warningAnomalies.length}`,
      });
    }

    // Thread Analysis
    const threadIds = new Set(events.map(e => e.metadata.thread_id));
    if (threadIds.size > 10) {
      results.push({
        id: 'many-threads',
        type: 'info',
        category: 'concurrency',
        title: 'High Thread Count',
        description: `${threadIds.size} unique threads detected. This may indicate good parallelization or potential thread management overhead.`,
        metric: `${threadIds.size}`,
      });
    }

    // Optimization Opportunity - Low Critical Path
    if (criticalPathData && criticalPathData.percentage_of_total < 40) {
      results.push({
        id: 'optimization-opportunity',
        type: 'success',
        category: 'optimization',
        title: 'Good Parallelization',
        description: `Only ${criticalPathData.percentage_of_total.toFixed(1)}% of time on critical path. System shows effective parallel execution.`,
        action: {
          label: 'View Critical Path',
          tab: 'performance',
        },
        metric: `${criticalPathData.percentage_of_total.toFixed(0)}%`,
      });
    }

    // All Clear
    if (results.length === 0 && raceCount === 0 && (anomaliesData?.anomaly_count || 0) === 0) {
      results.push({
        id: 'all-clear',
        type: 'success',
        category: 'performance',
        title: 'Trace Health Excellent',
        description: 'No issues detected. System is performing optimally with no race conditions or performance anomalies.',
      });
    }

    return results;
  }, [events, criticalPathData, anomaliesData, raceCount]);

  const criticalInsights = insights.filter(i => i.type === 'critical');
  const warningInsights = insights.filter(i => i.type === 'warning');
  const infoInsights = insights.filter(i => i.type === 'info' || i.type === 'success');

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'critical':
        return <AlertTriangle className="h-4 w-4 text-red-400" />;
      case 'warning':
        return <Clock className="h-4 w-4 text-orange-400" />;
      case 'success':
        return <Zap className="h-4 w-4 text-green-400" />;
      default:
        return <TrendingUp className="h-4 w-4 text-blue-400" />;
    }
  };

  const getTypeColor = (type: string) => {
    switch (type) {
      case 'critical':
        return 'border-red-500/30 bg-red-500/5';
      case 'warning':
        return 'border-orange-500/30 bg-orange-500/5';
      case 'success':
        return 'border-green-500/30 bg-green-500/5';
      default:
        return 'border-blue-500/30 bg-blue-500/5';
    }
  };

  const getCategoryBadgeColor = (category: string) => {
    switch (category) {
      case 'performance':
        return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
      case 'concurrency':
        return 'bg-red-500/20 text-red-300 border-red-500/30';
      case 'optimization':
        return 'bg-blue-500/20 text-blue-300 border-blue-500/30';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  if (insights.length === 0) {
    return null;
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Trace Insights & Recommendations
        </CardTitle>
      </CardHeader>
      <CardContent className="pb-3">
        <div className="space-y-2">
          {/* Critical Issues */}
          {criticalInsights.map(insight => (
            <div
              key={insight.id}
              className={cn(
                'p-3 rounded-md border transition-colors',
                getTypeColor(insight.type)
              )}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{getTypeIcon(insight.type)}</div>
                <div className="flex-1 space-y-2 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{insight.title}</span>
                      <Badge variant="outline" className={cn('text-[10px]', getCategoryBadgeColor(insight.category))}>
                        {insight.category}
                      </Badge>
                    </div>
                    {insight.metric && (
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {insight.metric}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {insight.description}
                  </p>
                  {insight.action && onNavigate && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => onNavigate(insight.action!.tab)}
                    >
                      {insight.action.label}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Warning Issues */}
          {warningInsights.map(insight => (
            <div
              key={insight.id}
              className={cn(
                'p-3 rounded-md border transition-colors',
                getTypeColor(insight.type)
              )}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{getTypeIcon(insight.type)}</div>
                <div className="flex-1 space-y-2 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{insight.title}</span>
                      <Badge variant="outline" className={cn('text-[10px]', getCategoryBadgeColor(insight.category))}>
                        {insight.category}
                      </Badge>
                    </div>
                    {insight.metric && (
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {insight.metric}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {insight.description}
                  </p>
                  {insight.action && onNavigate && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => onNavigate(insight.action!.tab)}
                    >
                      {insight.action.label}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}

          {/* Info/Success Items */}
          {infoInsights.map(insight => (
            <div
              key={insight.id}
              className={cn(
                'p-3 rounded-md border transition-colors',
                getTypeColor(insight.type)
              )}
            >
              <div className="flex items-start gap-3">
                <div className="mt-0.5">{getTypeIcon(insight.type)}</div>
                <div className="flex-1 space-y-2 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium text-sm">{insight.title}</span>
                      <Badge variant="outline" className={cn('text-[10px]', getCategoryBadgeColor(insight.category))}>
                        {insight.category}
                      </Badge>
                    </div>
                    {insight.metric && (
                      <Badge variant="secondary" className="font-mono text-[10px]">
                        {insight.metric}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground leading-relaxed">
                    {insight.description}
                  </p>
                  {insight.action && onNavigate && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => onNavigate(insight.action!.tab)}
                    >
                      {insight.action.label}
                    </Button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
