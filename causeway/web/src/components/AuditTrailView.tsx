import { useState, useMemo, useEffect } from 'react';
import { type AuditTrailData, type Event, type VariableAccess } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';
import { getThreadIdColor, getServiceColor } from '@/lib/event-colors';
import { Monitor, TrendingUp, Terminal, Network, Play, Pause, SkipBack, SkipForward, Home, ChevronLeft, ChevronRight } from 'lucide-react';
import { FocusView } from './audit-trail-views/FocusView';
import { GraphView } from './audit-trail-views/GraphView';
import { DebuggerView } from './audit-trail-views/DebuggerView';
import { CrossTraceView } from './audit-trail-views/CrossTraceView';

interface AuditTrailViewProps {
  auditTrails: Record<string, VariableAccess[]>; // Pre-fetched audit trails for all variables
  events: Event[]; // Pass in all events to auto-discover variables
  traceId: string; // Needed for constructing AuditTrailData
  onTraceSelect?: (traceId: string) => void;
}

interface VariableSummary {
  name: string;
  readCount: number;
  writeCount: number;
  raceCount: number;
  threads: Set<string>;
  firstAccess: string;
  lastAccess: string;
}

type AuditViewMode = 'focus' | 'graph' | 'debugger' | 'cross-trace';

export function AuditTrailView({ auditTrails, events, traceId, onTraceSelect }: AuditTrailViewProps) {
  const [selectedVariable, setSelectedVariable] = useState<string | null>(null);
  const [currentStep, setCurrentStep] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [viewMode, setViewMode] = useState<AuditViewMode>('debugger');

  // Construct data from auditTrails for the selected variable
  const data: AuditTrailData | null = useMemo(() => {
    if (!selectedVariable || !auditTrails[selectedVariable]) {
      return null;
    }
    return {
      trace_id: traceId,
      variable: selectedVariable,
      accesses: auditTrails[selectedVariable],
    };
  }, [selectedVariable, auditTrails, traceId]);

  // Auto-discover all variables from StateChange events
  const variableSummaries = useMemo(() => {
    const summaries = new Map<string, VariableSummary>();

    for (const event of events) {
      if (typeof event.kind === 'object' && 'StateChange' in event.kind) {
        const stateChange = event.kind.StateChange;
        const varName = stateChange.variable;

        if (!summaries.has(varName)) {
          summaries.set(varName, {
            name: varName,
            readCount: 0,
            writeCount: 0,
            raceCount: 0,
            threads: new Set(),
            firstAccess: event.timestamp,
            lastAccess: event.timestamp,
          });
        }

        const summary = summaries.get(varName)!;

        // Count access types
        const accessType = stateChange.access_type || 'Write';
        if (accessType === 'Read' || accessType === 'AtomicRead') {
          summary.readCount++;
        } else {
          summary.writeCount++;
        }

        summary.threads.add(event.metadata.thread_id);
        summary.lastAccess = event.timestamp;
      }
    }

    return Array.from(summaries.values()).sort((a, b) =>
      (b.readCount + b.writeCount) - (a.readCount + a.writeCount)
    );
  }, [events]);

  // Reconstruct state at current step
  const stateAtCurrentStep = useMemo((): VariableState[] => {
    if (!data || data.accesses.length === 0) return [];

    // Build state up to current step
    const stateMap = new Map<string, VariableState>();

    for (let i = 0; i <= currentStep && i < data.accesses.length; i++) {
      const access = data.accesses[i];
      stateMap.set(data.variable, {
        name: data.variable,
        value: access.new_value,
        lastModifiedBy: access.thread_id,
        lastModifiedAt: access.timestamp,
        isChanged: i === currentStep,
        accessType: access.access_type,
      });
    }

    return Array.from(stateMap.values());
  }, [data, currentStep]);

  // Reset playback when data changes
  useEffect(() => {
    setCurrentStep(0);
    setIsPlaying(false);
  }, [data]);

  // Auto-advance when playing
  useEffect(() => {
    if (!isPlaying || !data || currentStep >= data.accesses.length - 1) {
      if (isPlaying && data && currentStep >= data.accesses.length - 1) {
        setIsPlaying(false); // Stop at end
      }
      return;
    }
    const interval = setInterval(() => {
      setCurrentStep(prev => Math.min(prev + 1, data.accesses.length - 1));
    }, 500); // 2x speed
    return () => clearInterval(interval);
  }, [isPlaying, currentStep, data]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      if (!data) return;

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          setCurrentStep(prev => Math.max(0, prev - 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          setCurrentStep(prev => Math.min(data.accesses.length - 1, prev + 1));
          break;
        case ' ':
          e.preventDefault();
          setIsPlaying(prev => !prev);
          break;
        case 'Home':
          e.preventDefault();
          setCurrentStep(0);
          break;
        case 'End':
          e.preventDefault();
          setCurrentStep(data.accesses.length - 1);
          break;
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [data]);

  // Auto-select first variable if available and none selected
  useEffect(() => {
    if (variableSummaries.length > 0 && !selectedVariable) {
      setSelectedVariable(variableSummaries[0].name);
    }
  }, [variableSummaries, selectedVariable]);

  const handleVariableSelect = (varName: string) => {
    setSelectedVariable(varName);
  };

  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) + '.' + date.getMilliseconds().toString().padStart(3, '0');
    } catch {
      return timestamp;
    }
  };

  if (variableSummaries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-2">
        <h3 className="text-lg font-semibold">No variables found</h3>
        <p className="text-sm text-muted-foreground">
          This trace has no StateChange events to track
        </p>
      </div>
    );
  }

  const currentAccess = data && data.accesses.length > 0 ? data.accesses[currentStep] : null;

  return (
    <div className="grid grid-cols-4 gap-0 h-[calc(100dvh-5.5rem)]">
      {/* Left Sidebar - Variable List + Player */}
      <div className="col-span-1 border-r border-border flex flex-col">
        {/* Variable List - Scrollable */}
        <div className="flex-1 overflow-hidden flex flex-col px-3 pt-3">
          <div className="text-[10px] text-muted-foreground mb-2 px-2 uppercase tracking-wide">
            Variables ({variableSummaries.length})
          </div>
          <div className="space-y-1 overflow-y-auto flex-1 pr-1">
            {variableSummaries.map((summary) => (
              <button
                key={summary.name}
                onClick={() => handleVariableSelect(summary.name)}
                className={cn(
                  "w-full flex items-center justify-between p-2 rounded-md text-xs transition-colors group",
                  selectedVariable === summary.name
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-accent/50 text-muted-foreground"
                )}
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <span className="font-mono truncate" title={summary.name}>
                    {summary.name}
                  </span>
                </div>
                <div className="flex items-center gap-1 text-[10px]">
                  <span className="text-gray-400">{summary.readCount}R</span>
                  <span className="text-red-400">{summary.writeCount}W</span>
                  {summary.raceCount > 0 && (
                    <span className="text-destructive">⚠</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Time Travel Player - Fixed at Bottom */}
        {data && data.accesses.length > 0 && currentAccess && (
          <div className="border-t border-border px-3 pb-3 pt-3 space-y-3 flex-shrink-0">
              {/* Time Travel Header */}
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide px-2">
                Time Travel
              </div>

              {/* Progress Bar */}
              <div className="space-y-1">
                <div className="flex items-center justify-between text-[10px] text-muted-foreground px-1">
                  <span>Step {currentStep + 1}</span>
                  <span>{data.accesses.length}</span>
                </div>
                <div className="relative h-1.5 bg-muted rounded-full overflow-hidden cursor-pointer"
                  onClick={(e) => {
                    const rect = e.currentTarget.getBoundingClientRect();
                    const x = e.clientX - rect.left;
                    const percent = x / rect.width;
                    const step = Math.floor(percent * data.accesses.length);
                    setCurrentStep(Math.max(0, Math.min(step, data.accesses.length - 1)));
                  }}
                >
                  <div
                    className="absolute top-0 left-0 h-full bg-primary transition-all"
                    style={{ width: `${((currentStep + 1) / data.accesses.length) * 100}%` }}
                  />
                </div>
              </div>

              {/* Playback Controls */}
              <div className="flex items-center justify-between gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentStep(0)}
                  disabled={currentStep === 0}
                  className="h-7 w-7 p-0"
                >
                  <Home className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentStep(Math.max(0, currentStep - 1))}
                  disabled={currentStep === 0}
                  className="h-7 w-7 p-0"
                >
                  <ChevronLeft className="w-3 h-3" />
                </Button>
                <Button
                  variant="default"
                  size="sm"
                  onClick={() => setIsPlaying(!isPlaying)}
                  className="h-7 w-7 p-0"
                >
                  {isPlaying ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentStep(Math.min(data.accesses.length - 1, currentStep + 1))}
                  disabled={currentStep === data.accesses.length - 1}
                  className="h-7 w-7 p-0"
                >
                  <ChevronRight className="w-3 h-3" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setCurrentStep(data.accesses.length - 1)}
                  disabled={currentStep === data.accesses.length - 1}
                  className="h-7 w-7 p-0"
                >
                  <SkipForward className="w-3 h-3" />
                </Button>
              </div>

              {/* Keyboard shortcuts hint */}
              <div className="text-[9px] text-muted-foreground text-center px-1">
                ← → to step • Space to play/pause
              </div>
          </div>
        )}
      </div>

      {/* Right Panel - View Switcher and Content */}
      <div className="col-span-3 flex flex-col overflow-hidden">
        {!data ? (
          <div className="flex flex-col items-center justify-center h-64 text-center space-y-2 px-4 py-3">
            <h3 className="text-lg font-semibold">Select a variable</h3>
            <p className="text-sm text-muted-foreground">
              Choose a variable from the list to view its audit trail
            </p>
          </div>
        ) : data.accesses.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-64 text-center space-y-2 px-4 py-3">
            <h3 className="text-lg font-semibold">No accesses found</h3>
            <p className="text-sm text-muted-foreground">
              Variable "{data.variable}" was not accessed in this trace
            </p>
          </div>
        ) : (
          <>
            {/* View Switcher - Fixed at top */}
            <div className="flex items-center gap-2 border-b border-border pb-2 mb-0 flex-shrink-0 px-4 pt-3">
              <Button
                variant={viewMode === 'debugger' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('debugger')}
                className="h-8 text-xs"
              >
                <Terminal className="w-3.5 h-3.5 mr-1.5" />
                Debugger
              </Button>
              <Button
                variant={viewMode === 'focus' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('focus')}
                className="h-8 text-xs"
              >
                <Monitor className="w-3.5 h-3.5 mr-1.5" />
                Focus
              </Button>
              <Button
                variant={viewMode === 'graph' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('graph')}
                className="h-8 text-xs"
              >
                <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
                Graph
              </Button>
              <Button
                variant={viewMode === 'cross-trace' ? 'default' : 'ghost'}
                size="sm"
                onClick={() => setViewMode('cross-trace')}
                className="h-8 text-xs"
              >
                <Network className="w-3.5 h-3.5 mr-1.5" />
                Cross-Trace
              </Button>
            </div>

            {/* View Content - Scrollable */}
            <div className="flex-1 min-h-0 overflow-y-auto px-4 py-4">
              {viewMode === 'focus' && (
                <FocusView
                  data={data}
                  currentStep={currentStep}
                  isPlaying={isPlaying}
                  onStepChange={setCurrentStep}
                  onPlayPause={() => setIsPlaying(!isPlaying)}
                />
              )}
              {viewMode === 'graph' && (
                <GraphView
                  data={data}
                  currentStep={currentStep}
                  isPlaying={isPlaying}
                  onStepChange={setCurrentStep}
                  onPlayPause={() => setIsPlaying(!isPlaying)}
                />
              )}
              {viewMode === 'debugger' && (
                <DebuggerView
                  data={data}
                  currentStep={currentStep}
                  isPlaying={isPlaying}
                  onStepChange={setCurrentStep}
                  onPlayPause={() => setIsPlaying(!isPlaying)}
                  apiBaseUrl=""
                  onTraceSelect={onTraceSelect}
                />
              )}
              {viewMode === 'cross-trace' && (
                <CrossTraceView
                  data={data}
                  apiBaseUrl=""
                  onTraceSelect={onTraceSelect}
                />
              )}
            </div>
          </>
        )}

        {/* Old content - will remove this section */}
        {false && data && data.accesses.length > 0 && (
          <>
            {/* Header with Stats */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h3 className="font-mono text-sm">{data.variable}</h3>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span>{data.accesses.length} accesses</span>
                  <span className="text-blue-400">{data.accesses.filter(a => a.access_type.includes('Read')).length}R</span>
                  <span className="text-orange-400">{data.accesses.filter(a => a.access_type.includes('Write')).length}W</span>
                  <span>{new Set(data.accesses.map(a => a.thread_id)).size} threads</span>
                </div>
              </div>
              {data.accesses.filter(a => a.is_race).length > 0 && (
                <Badge className="text-[10px] bg-destructive/20 text-destructive border-destructive/30">
                  {data.accesses.filter(a => a.is_race).length} race{data.accesses.filter(a => a.is_race).length !== 1 ? 's' : ''}
                </Badge>
              )}
            </div>

            {/* Timeline - Only show current step and context */}
            <div className="space-y-2 max-h-[calc(100vh-26rem)] overflow-y-auto pr-2">
              {(() => {
                // Show current step plus 2 before and 2 after for context
                const contextSize = 2;
                const startIdx = Math.max(0, currentStep - contextSize);
                const endIdx = Math.min(data.accesses.length - 1, currentStep + contextSize);
                const visibleAccesses = data.accesses.slice(startIdx, endIdx + 1);

                return (
                  <>
                    {startIdx > 0 && (
                      <div className="text-center text-xs text-muted-foreground py-2">
                        ... {startIdx} earlier {startIdx === 1 ? 'access' : 'accesses'} ...
                      </div>
                    )}
                    {visibleAccesses.map((access, idx) => {
                      const actualIdx = startIdx + idx;
                      const isCurrent = actualIdx === currentStep;
                      return (
                        <div key={actualIdx} className="space-y-1">
                          <div className={cn(
                            "p-3 rounded-md border transition-all cursor-pointer",
                            access.is_race ? 'border-l-4 border-l-destructive' : 'border-border',
                            isCurrent && 'ring-2 ring-primary border-primary bg-primary/5 scale-[1.02]'
                          )}
                          onClick={() => setCurrentStep(actualIdx)}
                          >
                            {/* Header row */}
                            <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {access.is_race && <span className="text-sm">⚠️</span>}
                        <Badge className={cn(
                          "text-[10px]",
                          access.access_type.includes('Read')
                            ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                            : 'bg-orange-500/20 text-orange-300 border-orange-500/30'
                        )}>
                          {access.access_type}
                        </Badge>
                        <span className="font-mono text-[10px] text-muted-foreground">
                          {formatTimestamp(access.timestamp)}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        {isCurrent && <Badge variant="default" className="text-[9px]">Current</Badge>}
                        <span className="text-[10px] text-muted-foreground">#{actualIdx + 1}</span>
                      </div>
                    </div>

                    {/* Thread and Service */}
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground mb-2">
                      <span className={cn("font-mono", getThreadIdColor(access.thread_id))}>
                        {access.thread_id}
                      </span>
                      <span>•</span>
                      <span className={cn("font-mono", getServiceColor(access.service_name))}>
                        {access.service_name}
                      </span>
                    </div>

                    {/* Location */}
                    <div className="text-[10px] text-muted-foreground font-mono mb-2 truncate" title={access.location}>
                      {access.location}
                    </div>

                    {/* Value Change */}
                    <div className="flex items-center gap-2 font-mono text-xs p-2 bg-muted/50 rounded">
                      {access.old_value !== null && (
                        <>
                          <span className="text-muted-foreground">{JSON.stringify(access.old_value)}</span>
                          <span className="text-primary">→</span>
                        </>
                      )}
                      <span className="text-foreground">{JSON.stringify(access.new_value)}</span>
                    </div>

                    {/* Race Warning */}
                    {access.is_race && (
                      <div className="mt-2 p-2 rounded bg-destructive/10 border border-destructive/50 text-[10px]">
                        <div className="text-destructive mb-0.5">⚠️ Race condition</div>
                        <div className="text-muted-foreground">Concurrent modification from different thread</div>
                      </div>
                    )}
                  </div>

                  {/* Timeline Connector */}
                  {actualIdx < data.accesses.length - 1 && (
                    <div className="flex items-center justify-center py-1">
                      <div className={cn(
                        "text-xs font-mono px-3 py-1 rounded-full",
                        data.accesses[actualIdx + 1].has_causal_link_to_previous
                          ? 'bg-primary/20 text-primary'
                          : 'bg-muted text-muted-foreground'
                      )}>
                        {data.accesses[actualIdx + 1].has_causal_link_to_previous ? (
                          <>↓ Causal link</>
                        ) : (
                          <>⋮ Concurrent</>
                        )}
                      </div>
                    </div>
                  )}
                </div>
                      );
                    })}
                    {endIdx < data.accesses.length - 1 && (
                      <div className="text-center text-xs text-muted-foreground py-2">
                        ... {data.accesses.length - 1 - endIdx} later {data.accesses.length - 1 - endIdx === 1 ? 'access' : 'accesses'} ...
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
