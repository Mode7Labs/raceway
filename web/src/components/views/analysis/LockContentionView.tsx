import { useMemo, useState } from 'react';
import { type Event, type LockEvent, type LockHold, type LockContention, type LockMetrics } from '@/types';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Lock, AlertTriangle, CheckCircle, Users, TrendingUp } from 'lucide-react';
import { ServiceBadge } from '@/components/features/services/ServiceBadge';

interface LockContentionViewProps {
  events: Event[];
  selectedEventId: string | null;
  onEventSelect: (eventId: string) => void;
}

export function LockContentionView({ events, selectedEventId, onEventSelect }: LockContentionViewProps) {
  const [selectedLock, setSelectedLock] = useState<string | null>(null);

  // Extract lock events from trace
  const lockEvents = useMemo((): LockEvent[] => {
    const locks: LockEvent[] = [];

    events.forEach(event => {
      if (typeof event.kind === 'object') {
        if ('LockAcquire' in event.kind) {
          const lockData = event.kind.LockAcquire;
          locks.push({
            lock_id: lockData.lock_id,
            lock_type: lockData.lock_type || 'Mutex',
            thread_id: event.metadata.thread_id,
            service_name: event.metadata.service_name,
            event_id: event.id,
            timestamp: new Date(event.timestamp).getTime(),
            location: lockData.location || event.metadata.location || 'unknown',
            is_acquire: true,
            event,
          });
        } else if ('LockRelease' in event.kind) {
          const lockData = event.kind.LockRelease;
          locks.push({
            lock_id: lockData.lock_id,
            lock_type: lockData.lock_type || 'Mutex',
            thread_id: event.metadata.thread_id,
            service_name: event.metadata.service_name,
            event_id: event.id,
            timestamp: new Date(event.timestamp).getTime(),
            location: lockData.location || event.metadata.location || 'unknown',
            is_acquire: false,
            event,
          });
        }
      }
    });

    return locks.sort((a, b) => a.timestamp - b.timestamp);
  }, [events]);

  // Build lock holds and detect contentions
  const { lockHolds, contentions, metrics } = useMemo(() => {
    if (lockEvents.length === 0) {
      return { lockHolds: [], contentions: [], metrics: new Map<string, LockMetrics>() };
    }

    const holds: LockHold[] = [];
    const contentions: LockContention[] = [];

    // Track active lock holders per lock_id
    const activeLocks = new Map<string, Map<string, LockEvent>>(); // lock_id -> thread_id -> acquire event

    // Track pending acquires (waiting threads)
    const pendingAcquires = new Map<string, LockEvent[]>(); // lock_id -> waiting threads

    lockEvents.forEach(lockEvent => {
      const { lock_id, thread_id, is_acquire } = lockEvent;

      if (is_acquire) {
        // Check if lock is currently held by another thread
        const holders = activeLocks.get(lock_id) || new Map();
        const otherHolders = Array.from(holders.entries()).filter(([tid]) => tid !== thread_id);

        if (otherHolders.length > 0) {
          // Contention detected: lock is held by another thread
          // Add to pending acquires
          const pending = pendingAcquires.get(lock_id) || [];
          pending.push(lockEvent);
          pendingAcquires.set(lock_id, pending);

          // We'll resolve contention duration when the blocking thread releases
        } else {
          // Lock acquired immediately
          if (!activeLocks.has(lock_id)) {
            activeLocks.set(lock_id, new Map());
          }
          activeLocks.get(lock_id)!.set(thread_id, lockEvent);
        }
      } else {
        // Lock release
        const holders = activeLocks.get(lock_id);
        if (holders && holders.has(thread_id)) {
          const acquireEvent = holders.get(thread_id)!;
          const duration = lockEvent.timestamp - acquireEvent.timestamp;

          // Record lock hold
          holds.push({
            lock_id,
            thread_id,
            acquire_time: acquireEvent.timestamp,
            release_time: lockEvent.timestamp,
            duration,
            acquire_event: acquireEvent.event,
            release_event: lockEvent.event,
          });

          // Remove from active locks
          holders.delete(thread_id);

          // Check if any threads were waiting
          const pending = pendingAcquires.get(lock_id) || [];
          if (pending.length > 0) {
            // First pending thread can now acquire
            const waitingEvent = pending.shift()!;
            const waitDuration = lockEvent.timestamp - waitingEvent.timestamp;

            // Record contention
            contentions.push({
              lock_id,
              blocked_thread: waitingEvent.thread_id,
              blocking_thread: thread_id,
              wait_start: waitingEvent.timestamp,
              wait_end: lockEvent.timestamp,
              wait_duration: waitDuration,
              blocked_event: waitingEvent.event,
            });

            // Now the waiting thread acquires the lock
            holders.set(waitingEvent.thread_id, waitingEvent);
            pendingAcquires.set(lock_id, pending);
          }
        }
      }
    });

    // Handle unreleased locks
    activeLocks.forEach((holders, lock_id) => {
      holders.forEach((acquireEvent, thread_id) => {
        holds.push({
          lock_id,
          thread_id,
          acquire_time: acquireEvent.timestamp,
          release_time: null,
          duration: 0,
          acquire_event: acquireEvent.event,
          release_event: null,
        });
      });
    });

    // Calculate metrics per lock
    const metricsMap = new Map<string, LockMetrics>();
    const lockIds = new Set(lockEvents.map(e => e.lock_id));

    lockIds.forEach(lock_id => {
      const lockHolds = holds.filter(h => h.lock_id === lock_id && h.release_time !== null);
      const lockContentions = contentions.filter(c => c.lock_id === lock_id);
      const threads = new Set(lockHolds.map(h => h.thread_id));

      const totalHoldTime = lockHolds.reduce((sum, h) => sum + h.duration, 0);
      const avgHoldTime = lockHolds.length > 0 ? totalHoldTime / lockHolds.length : 0;
      const maxHoldTime = lockHolds.length > 0 ? Math.max(...lockHolds.map(h => h.duration)) : 0;

      const totalWaitTime = lockContentions.reduce((sum, c) => sum + c.wait_duration, 0);
      const avgWaitTime = lockContentions.length > 0 ? totalWaitTime / lockContentions.length : 0;
      const maxWaitTime = lockContentions.length > 0 ? Math.max(...lockContentions.map(c => c.wait_duration)) : 0;

      metricsMap.set(lock_id, {
        lock_id,
        total_acquisitions: lockHolds.length,
        total_hold_time: totalHoldTime,
        avg_hold_time: avgHoldTime,
        max_hold_time: maxHoldTime,
        contention_count: lockContentions.length,
        avg_wait_time: avgWaitTime,
        max_wait_time: maxWaitTime,
        threads: Array.from(threads),
      });
    });

    return { lockHolds: holds, contentions, metrics: metricsMap };
  }, [lockEvents]);

  // Get unique lock IDs
  const lockIds = useMemo(() => {
    return Array.from(new Set(lockEvents.map(e => e.lock_id))).sort();
  }, [lockEvents]);

  // Auto-select first lock with contentions, or first lock
  useMemo(() => {
    if (!selectedLock && lockIds.length > 0) {
      const locksWithContentions = lockIds.filter(id => (metrics.get(id)?.contention_count || 0) > 0);
      setSelectedLock(locksWithContentions[0] || lockIds[0]);
    }
  }, [lockIds, selectedLock, metrics]);

  // Filter data for selected lock
  const selectedMetrics = selectedLock ? metrics.get(selectedLock) : null;
  const selectedHolds = selectedLock ? lockHolds.filter(h => h.lock_id === selectedLock) : [];
  const selectedContentions = selectedLock ? contentions.filter(c => c.lock_id === selectedLock) : [];

  // Get threads involved with selected lock
  const threads = useMemo(() => {
    if (!selectedLock) return [];
    return Array.from(new Set(selectedHolds.map(h => h.thread_id))).sort();
  }, [selectedLock, selectedHolds]);

  // Calculate timeline bounds
  const { minTime, maxTime, totalDuration } = useMemo(() => {
    if (selectedHolds.length === 0) {
      return { minTime: 0, maxTime: 0, totalDuration: 0 };
    }

    const timestamps = selectedHolds.flatMap(h =>
      h.release_time ? [h.acquire_time, h.release_time] : [h.acquire_time]
    );
    const min = Math.min(...timestamps);
    const max = Math.max(...timestamps);
    return { minTime: min, maxTime: max, totalDuration: max - min };
  }, [selectedHolds]);

  const formatTimestamp = (timestamp: number): string => {
    return new Date(timestamp).toISOString().substring(11, 23);
  };

  const formatDuration = (ms: number): string => {
    if (ms < 1) return `${(ms * 1000).toFixed(0)}μs`;
    if (ms < 1000) return `${ms.toFixed(2)}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  // Generate recommendations
  const recommendations = useMemo(() => {
    if (!selectedMetrics) return [];
    const recs: string[] = [];

    if (selectedMetrics.contention_count > 5) {
      recs.push("High contention detected - consider splitting into finer-grained locks");
    }

    if (selectedMetrics.avg_hold_time > 50) {
      recs.push("Long average hold time - consider reducing critical section size");
    }

    if (selectedMetrics.threads.length > 4) {
      recs.push("Many threads accessing lock - consider lock-free data structures");
    }

    if (selectedMetrics.max_wait_time > selectedMetrics.avg_hold_time * 3) {
      recs.push("Significant wait time spikes detected - investigate blocking operations");
    }

    if (recs.length === 0) {
      recs.push("No major issues detected with this lock");
    }

    return recs;
  }, [selectedMetrics]);

  if (lockEvents.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-2">
        <Lock className="h-12 w-12 text-muted-foreground/50" />
        <h3 className="text-lg font-semibold">No Lock Events</h3>
        <p className="text-sm text-muted-foreground">
          This trace does not contain any lock acquire/release events.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Lock Selector */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <Lock className="h-4 w-4" />
            Select Lock to Analyze
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Select value={selectedLock || undefined} onValueChange={setSelectedLock}>
            <SelectTrigger className="w-full">
              <SelectValue placeholder="Select a lock..." />
            </SelectTrigger>
            <SelectContent>
              {lockIds.map(lockId => {
                const lockMetrics = metrics.get(lockId);
                const hasContentions = (lockMetrics?.contention_count || 0) > 0;

                return (
                  <SelectItem key={lockId} value={lockId}>
                    <div className="flex items-center justify-between gap-3 w-full">
                      <span className="font-mono text-sm">{lockId}</span>
                      {hasContentions && (
                        <Badge variant="destructive" className="text-[10px]">
                          {lockMetrics!.contention_count} contentions
                        </Badge>
                      )}
                    </div>
                  </SelectItem>
                );
              })}
            </SelectContent>
          </Select>
        </CardContent>
      </Card>

      {selectedLock && selectedMetrics && (
        <>
          {/* Metrics Summary */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium">Metrics Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="space-y-1">
                  <div className="text-[10px] text-muted-foreground uppercase">Acquisitions</div>
                  <div className="text-2xl font-bold">{selectedMetrics.total_acquisitions}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] text-muted-foreground uppercase">Avg Hold Time</div>
                  <div className="text-2xl font-bold">{formatDuration(selectedMetrics.avg_hold_time)}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] text-muted-foreground uppercase">Max Hold Time</div>
                  <div className="text-2xl font-bold">{formatDuration(selectedMetrics.max_hold_time)}</div>
                </div>
                <div className="space-y-1">
                  <div className="text-[10px] text-muted-foreground uppercase flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Contentions
                  </div>
                  <div className={cn(
                    "text-2xl font-bold",
                    selectedMetrics.contention_count > 0 ? "text-orange-500" : "text-green-500"
                  )}>
                    {selectedMetrics.contention_count}
                  </div>
                </div>
              </div>

              {selectedMetrics.contention_count > 0 && (
                <div className="mt-4 pt-4 border-t border-border grid grid-cols-2 gap-4">
                  <div className="space-y-1">
                    <div className="text-[10px] text-muted-foreground uppercase">Avg Wait Time</div>
                    <div className="text-lg font-semibold text-orange-500">
                      {formatDuration(selectedMetrics.avg_wait_time)}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-[10px] text-muted-foreground uppercase">Max Wait Time</div>
                    <div className="text-lg font-semibold text-red-500">
                      {formatDuration(selectedMetrics.max_wait_time)}
                    </div>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Timeline Visualization - to be continued in next part */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <TrendingUp className="h-4 w-4" />
                Lock Timeline
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {/* Time axis */}
                <div className="relative h-8 border-b border-border">
                  <div className="absolute left-0 text-[10px] text-muted-foreground">
                    {formatTimestamp(minTime)}
                  </div>
                  <div className="absolute right-0 text-[10px] text-muted-foreground">
                    {formatTimestamp(maxTime)}
                  </div>
                  <div className="absolute left-1/2 -translate-x-1/2 text-[10px] text-muted-foreground">
                    Duration: {formatDuration(totalDuration)}
                  </div>
                </div>

                {/* Thread lanes */}
                <div className="space-y-3">
                  {threads.map(thread => {
                    const threadHolds = selectedHolds.filter(h => h.thread_id === thread);
                    const threadContentions = selectedContentions.filter(c => c.blocked_thread === thread);

                    // Get service name from the first lock event for this thread
                    const threadLockEvent = lockEvents.find(e => e.thread_id === thread);
                    const serviceName = threadLockEvent?.service_name || 'unknown';

                    return (
                      <div key={thread} className="space-y-1">
                        <div className="flex items-center gap-2">
                          <Users className="h-3 w-3 text-muted-foreground" />
                          <span className="text-xs font-mono text-muted-foreground">{thread}</span>
                          <ServiceBadge
                            serviceName={serviceName}
                            tags={threadLockEvent?.event?.metadata?.tags}
                          />
                          <Badge variant="outline" className="text-[10px]">
                            {threadHolds.length} holds
                          </Badge>
                          {threadContentions.length > 0 && (
                            <Badge variant="destructive" className="text-[10px]">
                              {threadContentions.length} blocked
                            </Badge>
                          )}
                        </div>

                        <div className="relative h-10 bg-muted/30 rounded">
                          {/* Lock hold bars */}
                          {threadHolds.map((hold, idx) => {
                            if (hold.release_time === null || totalDuration === 0) return null;

                            const left = ((hold.acquire_time - minTime) / totalDuration) * 100;
                            const width = (hold.duration / totalDuration) * 100;
                            const isSelected = hold.acquire_event.id === selectedEventId ||
                                             hold.release_event?.id === selectedEventId;

                            return (
                              <button
                                key={idx}
                                onClick={() => onEventSelect(hold.acquire_event.id)}
                                className={cn(
                                  "absolute top-1/2 -translate-y-1/2 h-7 rounded transition-all cursor-pointer",
                                  isSelected
                                    ? "bg-blue-500 ring-2 ring-primary z-10"
                                    : "bg-blue-500/80 hover:bg-blue-500"
                                )}
                                style={{
                                  left: `${left}%`,
                                  width: `${Math.max(width, 0.5)}%`,
                                  minWidth: '2px',
                                }}
                                title={`Hold: ${formatDuration(hold.duration)}\nAcquired: ${formatTimestamp(hold.acquire_time)}`}
                              />
                            );
                          })}

                          {/* Contention indicators */}
                          {threadContentions.map((contention, idx) => {
                            const left = ((contention.wait_start - minTime) / totalDuration) * 100;
                            const width = (contention.wait_duration / totalDuration) * 100;
                            const isSelected = contention.blocked_event.id === selectedEventId;

                            return (
                              <button
                                key={`contention-${idx}`}
                                onClick={() => onEventSelect(contention.blocked_event.id)}
                                className={cn(
                                  "absolute top-1/2 -translate-y-1/2 h-7 rounded border-2 border-red-500 cursor-pointer",
                                  "bg-red-500/30 hover:bg-red-500/50 transition-all",
                                  isSelected && "ring-2 ring-primary z-10"
                                )}
                                style={{
                                  left: `${left}%`,
                                  width: `${Math.max(width, 1)}%`,
                                  minWidth: '4px',
                                  backgroundImage: 'repeating-linear-gradient(45deg, transparent, transparent 2px, rgba(239, 68, 68, 0.3) 2px, rgba(239, 68, 68, 0.3) 4px)',
                                }}
                                title={`⚠️ Blocked: ${formatDuration(contention.wait_duration)}\nWaiting for: ${contention.blocking_thread}`}
                              >
                                <span className="text-[9px] text-red-500 font-bold">⚠️</span>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Contention Events */}
          {selectedContentions.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-medium flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-orange-500" />
                  Contention Events
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="space-y-2">
                  {selectedContentions.map((contention, idx) => {
                    // Get service names for blocked and blocking threads
                    const blockedThreadEvent = lockEvents.find(e => e.thread_id === contention.blocked_thread);
                    const blockingThreadEvent = lockEvents.find(e => e.thread_id === contention.blocking_thread);
                    const blockedService = blockedThreadEvent?.service_name || 'unknown';
                    const blockingService = blockingThreadEvent?.service_name || 'unknown';

                    return (
                      <button
                        key={idx}
                        onClick={() => onEventSelect(contention.blocked_event.id)}
                        className={cn(
                          "w-full text-left p-3 rounded-md border transition-all hover:bg-accent/50",
                          contention.blocked_event.id === selectedEventId
                            ? "border-primary bg-primary/5"
                            : "border-border"
                        )}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <AlertTriangle className="h-3 w-3 text-orange-500" />
                              <span className="text-xs font-medium">
                                Thread <code className="font-mono text-cyan-400">{contention.blocked_thread}</code> blocked
                              </span>
                              <ServiceBadge
                                serviceName={blockedService}
                                tags={blockedThreadEvent?.event?.metadata?.tags}
                              />
                            </div>
                            <div className="text-xs text-muted-foreground pl-5 flex items-center gap-2 flex-wrap">
                              <span>Waiting for thread <code className="font-mono">{contention.blocking_thread}</code> to release lock</span>
                              <ServiceBadge
                                serviceName={blockingService}
                                tags={blockingThreadEvent?.event?.metadata?.tags}
                              />
                            </div>
                          </div>
                          <div className="text-xs font-mono text-orange-500 font-semibold">
                            {formatDuration(contention.wait_duration)}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recommendations */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <CheckCircle className="h-4 w-4" />
                Recommendations
              </CardTitle>
            </CardHeader>
            <CardContent>
              <ul className="space-y-2">
                {recommendations.map((rec, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm">
                    <span className="text-muted-foreground">•</span>
                    <span>{rec}</span>
                  </li>
                ))}
              </ul>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
