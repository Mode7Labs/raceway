import { useEffect, useState } from 'react';
import { Card, CardContent } from './ui/card';
import { RacewayAPI } from '@/api';
import type { GlobalRace } from '@/types';
import { AlertTriangle, AlertCircle, Info } from 'lucide-react';
import { TraceLink } from './TraceLink';
import { VariableLink } from './VariableLink';

interface GlobalRacesProps {
  onNavigateToTrace: (traceId: string) => void;
  onNavigateToVariable: (variableName: string, traceId?: string) => void;
}

export function GlobalRaces({ onNavigateToTrace, onNavigateToVariable }: GlobalRacesProps) {
  const [races, setRaces] = useState<GlobalRace[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchRaces = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await RacewayAPI.getGlobalRaces();
        if (response.data) {
          setRaces(response.data.races);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load global races');
      } finally {
        setLoading(false);
      }
    };

    fetchRaces();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-muted-foreground">Loading global race conditions...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-red-400">Error: {error}</div>
      </div>
    );
  }

  if (races.length === 0) {
    return (
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-6">
          <div className="flex flex-col items-center justify-center h-48 text-center">
            <div className="text-green-400 mb-2">
              <AlertCircle className="w-12 h-12" />
            </div>
            <div className="text-lg font-medium text-green-400 mb-1">No Global Races Detected</div>
            <div className="text-sm text-muted-foreground">
              All shared variables are properly synchronized across traces
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const criticalRaces = races.filter((r) => r.severity === 'CRITICAL');
  const warningRaces = races.filter((r) => r.severity === 'WARNING');
  const infoRaces = races.filter((r) => r.severity === 'INFO');

  return (
    <div className="space-y-4">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertCircle className="w-4 h-4 text-red-400" />
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                Critical
              </div>
            </div>
            <div className="text-2xl font-bold font-mono text-red-400">
              {criticalRaces.length}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Write-Write conflicts
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-4 h-4 text-orange-400" />
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                Warning
              </div>
            </div>
            <div className="text-2xl font-bold font-mono text-orange-400">
              {warningRaces.length}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Read-Write conflicts
            </div>
          </CardContent>
        </Card>

        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <div className="flex items-center gap-2 mb-2">
              <Info className="w-4 h-4 text-blue-400" />
              <div className="text-xs text-muted-foreground uppercase tracking-wide">
                Info
              </div>
            </div>
            <div className="text-2xl font-bold font-mono text-blue-400">
              {infoRaces.length}
            </div>
            <div className="text-xs text-muted-foreground mt-1">
              Concurrent reads
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Race Details */}
      <Card className="bg-card/50 border-border/50">
        <CardContent className="p-4">
          <h3 className="text-sm font-semibold mb-3">Global Race Conditions</h3>
          <p className="text-xs text-muted-foreground mb-4">
            Variables with concurrent access across multiple traces or threads
          </p>

          <div className="space-y-3">
            {races.map((race, index) => {
              const severityIcon =
                race.severity === 'CRITICAL' ? (
                  <AlertCircle className="w-5 h-5 text-red-400" />
                ) : race.severity === 'WARNING' ? (
                  <AlertTriangle className="w-5 h-5 text-orange-400" />
                ) : (
                  <Info className="w-5 h-5 text-blue-400" />
                );

              const severityColor =
                race.severity === 'CRITICAL'
                  ? 'border-red-500/30 bg-red-500/5'
                  : race.severity === 'WARNING'
                  ? 'border-orange-500/30 bg-orange-500/5'
                  : 'border-blue-500/30 bg-blue-500/5';

              const severityTextColor =
                race.severity === 'CRITICAL'
                  ? 'text-red-400'
                  : race.severity === 'WARNING'
                  ? 'text-orange-400'
                  : 'text-blue-400';

              return (
                <div
                  key={index}
                  className={`border rounded-lg p-4 ${severityColor}`}
                >
                  <div className="flex items-start gap-3">
                    {severityIcon}
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          <VariableLink
                            variableName={race.variable}
                            onClick={onNavigateToVariable}
                            className="text-sm font-mono font-medium text-foreground/90"
                          />
                          <span className={`text-xs px-2 py-0.5 rounded ${severityTextColor} border border-current/20`}>
                            {race.severity}
                          </span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-xs">
                        <div>
                          <div className="text-muted-foreground mb-1">Traces</div>
                          <div className="font-mono text-foreground/90">
                            {race.trace_count}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-1">Total Accesses</div>
                          <div className="font-mono text-foreground/90">
                            {race.access_count}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-1">Threads</div>
                          <div className="font-mono text-foreground/90">
                            {race.thread_count}
                          </div>
                        </div>
                        <div>
                          <div className="text-muted-foreground mb-1">Access Types</div>
                          <div className="flex gap-1">
                            {race.access_types.map((type) => (
                              <span
                                key={type}
                                className="px-1.5 py-0.5 rounded bg-muted text-[10px] font-mono"
                              >
                                {type}
                              </span>
                            ))}
                          </div>
                        </div>
                      </div>

                      {/* Affected Traces */}
                      <div className="mt-3 pt-3 border-t border-border/30">
                        <div className="text-xs text-muted-foreground mb-2">
                          Affected Traces ({race.trace_ids.length})
                        </div>
                        <div className="flex flex-wrap gap-1.5">
                          {race.trace_ids.slice(0, 5).map((traceId) => (
                            <TraceLink
                              key={traceId}
                              traceId={traceId}
                              onClick={onNavigateToTrace}
                              className="px-2 py-1 rounded text-[10px] font-mono bg-background/50 hover:bg-background border border-border/50 hover:border-blue-500/50 transition-colors cursor-pointer text-blue-400 hover:text-blue-300"
                              showShortId
                            />
                          ))}
                          {race.trace_ids.length > 5 && (
                            <span className="px-2 py-1 text-[10px] text-muted-foreground">
                              ... and {race.trace_ids.length - 5} more
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="mt-3 text-xs text-muted-foreground">
                        {race.severity === 'CRITICAL' &&
                          'Multiple threads writing to the same variable without synchronization - high risk of data corruption'}
                        {race.severity === 'WARNING' &&
                          'Mixed read/write access across threads - potential for stale reads'}
                        {race.severity === 'INFO' &&
                          'Concurrent reads detected - generally safe but may indicate shared state'}
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </CardContent>
      </Card>

      {/* Recommendations */}
      {(criticalRaces.length > 0 || warningRaces.length > 0) && (
        <Card className="bg-card/50 border-border/50">
          <CardContent className="p-4">
            <h3 className="text-sm font-semibold mb-3">Recommendations</h3>
            <div className="space-y-2 text-xs">
              {criticalRaces.length > 0 && (
                <div className="flex items-start gap-2">
                  <AlertCircle className="w-4 h-4 text-red-400 mt-0.5" />
                  <div>
                    <div className="font-medium text-red-400">Critical Action Required</div>
                    <div className="text-muted-foreground">
                      Add proper synchronization (locks, mutexes) for write-write conflicts or
                      redesign to avoid shared mutable state
                    </div>
                  </div>
                </div>
              )}
              {warningRaces.length > 0 && (
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-4 h-4 text-orange-400 mt-0.5" />
                  <div>
                    <div className="font-medium text-orange-400">Review Recommended</div>
                    <div className="text-muted-foreground">
                      Consider using atomic operations or reader-writer locks for mixed access
                      patterns
                    </div>
                  </div>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
