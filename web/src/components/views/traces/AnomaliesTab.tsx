import { useState, useMemo } from 'react';
import { type AnomaliesData } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { Search, X, Filter } from 'lucide-react';

interface AnomaliesTabProps {
  data: AnomaliesData | null;
}

export function AnomaliesTab({ data }: AnomaliesTabProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [severityFilter, setSeverityFilter] = useState('all');
  const [eventKindFilter, setEventKindFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);
  if (!data || data.anomalies.length === 0) {
    return (
      <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-3">
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="pt-6">
            <div className="flex items-start gap-3">
              <span className="text-2xl">✓</span>
              <div className="space-y-1">
                <div className="font-medium text-sm">No Performance Anomalies Detected</div>
                <p className="text-sm text-muted-foreground">
                  All operations completed within expected time ranges. Your application is performing well!
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
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

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'Critical':
        return 'bg-red-500/20 text-red-300 border-red-500/30';
      case 'Warning':
        return 'bg-orange-500/20 text-orange-300 border-orange-500/30';
      case 'Minor':
        return 'bg-yellow-500/20 text-yellow-300 border-yellow-500/30';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  // Extract unique event kinds and severities
  const uniqueEventKinds = useMemo(() => {
    const kinds = new Set(data.anomalies.map(a => a.event_kind));
    return Array.from(kinds).sort();
  }, [data.anomalies]);

  const uniqueSeverities = useMemo(() => {
    const severities = new Set(data.anomalies.map(a => a.severity));
    return Array.from(severities).sort();
  }, [data.anomalies]);

  // Filter anomalies
  const filteredAnomalies = useMemo(() => {
    let result = data.anomalies;

    // Search query filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(anomaly =>
        anomaly.event_id.toLowerCase().includes(query) ||
        anomaly.event_kind.toLowerCase().includes(query) ||
        anomaly.description.toLowerCase().includes(query) ||
        anomaly.location.toLowerCase().includes(query)
      );
    }

    // Severity filter
    if (severityFilter !== 'all') {
      result = result.filter(a => a.severity === severityFilter);
    }

    // Event kind filter
    if (eventKindFilter !== 'all') {
      result = result.filter(a => a.event_kind === eventKindFilter);
    }

    return result;
  }, [data.anomalies, searchQuery, severityFilter, eventKindFilter]);

  const criticalCount = data.anomalies.filter(a => a.severity === 'Critical').length;
  const warningCount = data.anomalies.filter(a => a.severity === 'Warning').length;
  const minorCount = data.anomalies.filter(a => a.severity === 'Minor').length;

  const hasActiveFilters = searchQuery.trim() !== '' || severityFilter !== 'all' || eventKindFilter !== 'all';
  const activeFilterCount = (searchQuery.trim() ? 1 : 0) + (severityFilter !== 'all' ? 1 : 0) + (eventKindFilter !== 'all' ? 1 : 0);

  const clearFilters = () => {
    setSearchQuery('');
    setSeverityFilter('all');
    setEventKindFilter('all');
  };

  return (
    <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-3">
      <div className="space-y-4">
        {/* Summary Card */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-sm font-medium">Anomalies Summary</CardTitle>
          </CardHeader>
          <CardContent className="pb-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <div className="space-y-0.5">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Anomalies</div>
                <div className="text-sm font-medium font-mono">{data.anomaly_count}</div>
              </div>
              <div className="space-y-0.5">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Critical</div>
                <div className="text-sm font-medium font-mono text-red-400">{criticalCount}</div>
              </div>
              <div className="space-y-0.5">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Warning</div>
                <div className="text-sm font-medium font-mono text-red-400/70">{warningCount}</div>
              </div>
              <div className="space-y-0.5">
                <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Minor</div>
                <div className="text-sm font-medium font-mono text-gray-400">{minorCount}</div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Search and Filter */}
        {data.anomaly_count > 0 && (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder="Search anomalies (ID, kind, description, location...)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="pl-9 h-9 text-xs"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <Button
                variant={showFilters ? 'default' : 'outline'}
                size="sm"
                className="h-9 gap-1.5"
                onClick={() => setShowFilters(!showFilters)}
              >
                <Filter className="h-3.5 w-3.5" />
                Filters
                {activeFilterCount > 0 && (
                  <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
                    {activeFilterCount}
                  </Badge>
                )}
              </Button>
              {hasActiveFilters && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-9 text-xs"
                  onClick={clearFilters}
                >
                  Clear All
                </Button>
              )}
            </div>

            {/* Filter Dropdowns */}
            {showFilters && (
              <Card className="bg-muted/30">
                <CardContent className="p-3">
                  <div className="grid grid-cols-2 gap-2">
                    {/* Severity Filter */}
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        Severity
                      </label>
                      <Select
                        value={severityFilter}
                        onValueChange={setSeverityFilter}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Severities</SelectItem>
                          {uniqueSeverities.map(severity => (
                            <SelectItem key={severity} value={severity}>
                              {severity}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>

                    {/* Event Kind Filter */}
                    <div className="space-y-1">
                      <label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                        Event Type
                      </label>
                      <Select
                        value={eventKindFilter}
                        onValueChange={setEventKindFilter}
                      >
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="all">All Types</SelectItem>
                          {uniqueEventKinds.map(kind => (
                            <SelectItem key={kind} value={kind}>
                              {kind}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}

            {/* Results Summary */}
            <div className="flex items-center justify-between text-[10px] text-muted-foreground">
              <span>
                Showing {filteredAnomalies.length} of {data.anomalies.length} anomalies
                {hasActiveFilters && ' (filtered)'}
              </span>
            </div>
          </div>
        )}

        {/* Anomalies List */}
        {data.anomaly_count === 0 ? (
          <Card className="border-green-500/20 bg-green-500/5">
            <CardContent className="pt-6">
              <div className="flex items-start gap-3">
                <span className="text-2xl">✓</span>
                <div className="space-y-1">
                  <div className="font-medium text-sm">No Performance Anomalies Detected</div>
                  <p className="text-sm text-muted-foreground">
                    All operations completed within expected time ranges. Your application is performing well!
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Detected Anomalies</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {filteredAnomalies.map((anomaly, idx) => (
                  <div
                    key={anomaly.event_id}
                    className={cn(
                      "p-3 rounded-md border transition-colors",
                      anomaly.severity === 'Critical' && "bg-red-500/5 border-red-500/30",
                      anomaly.severity === 'Warning' && "bg-orange-500/5 border-orange-500/30",
                      anomaly.severity === 'Minor' && "bg-yellow-500/5 border-yellow-500/30"
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <Badge variant="outline" className="mt-0.5 text-[10px]">
                        {idx + 1}
                      </Badge>
                      <div className="flex-1 space-y-2 min-w-0">
                        {/* Header Row */}
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-mono text-[10px] text-muted-foreground">
                            {formatTimestamp(anomaly.timestamp)}
                          </span>
                          <Badge className={cn("font-mono text-[10px]", getSeverityColor(anomaly.severity))}>
                            {anomaly.severity}
                          </Badge>
                          <span className="font-mono text-xs text-foreground">
                            {anomaly.event_kind}
                          </span>
                        </div>

                        {/* Description */}
                        <div className="text-sm text-foreground">
                          {anomaly.description}
                        </div>

                        {/* Timing Info */}
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-2 text-xs">
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Actual:</span>
                            <span className="font-mono text-foreground font-semibold">
                              {anomaly.actual_duration_ms.toFixed(2)} ms
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Expected:</span>
                            <span className="font-mono text-muted-foreground">
                              {anomaly.expected_duration_ms.toFixed(2)} ms
                            </span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <span className="text-muted-foreground">Deviation:</span>
                            <span className="font-mono text-red-400 font-semibold">
                              {anomaly.std_dev_from_mean.toFixed(1)}σ
                            </span>
                          </div>
                        </div>

                        {/* Location */}
                        <div className="text-[11px] text-muted-foreground font-mono truncate">
                          {anomaly.location}
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
