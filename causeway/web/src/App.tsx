import { useState, useEffect, useCallback } from 'react';
import { RacewayAPI } from './api';
import {type ViewMode, type Event, type AnomaliesData, type CriticalPathData, type DependenciesData, type AuditTrailData } from './types';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { TraceList } from './components/TraceList';
import { EventsTabWithSwitcher } from './components/EventsTabWithSwitcher';
import { CriticalPathView } from './components/CriticalPathView';
import { DependenciesView } from './components/DependenciesView';
import { AuditTrailView } from './components/AuditTrailView';
import { EventDetails } from './components/EventDetails';
import { RaceConditions } from './components/RaceConditions';
import { ThemeToggle } from './components/theme-toggle';
import { ExportMenu } from './components/ExportMenu';
import { Button } from './components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Badge } from './components/ui/badge';
import { AlertBanner } from './components/AlertBanner';
import { OverviewTab } from './components/OverviewTab';
import { AnomaliesTab } from './components/AnomaliesTab';
import { Loader2 } from 'lucide-react';
import logo from './static/icon.png';

export default function App() {
  const [traces, setTraces] = useState<string[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('Connecting...');

  // Data caches
  const [events, setEvents] = useState<Event[]>([]);
  const [anomaliesData, setAnomaliesData] = useState<AnomaliesData | null>(null);
  const [criticalPathData, setCriticalPathData] = useState<CriticalPathData | null>(null);
  const [dependenciesData, setDependenciesData] = useState<DependenciesData | null>(null);
  const [auditTrailData, setAuditTrailData] = useState<AuditTrailData | null>(null);
  const [selectedVariable, setSelectedVariable] = useState<string | null>(null);
  const [raceCount, setRaceCount] = useState<number>(0);
  const [raceInfo, setRaceInfo] = useState<string[]>([]);
  const [tracesWithRaces, setTracesWithRaces] = useState<Set<string>>(new Set());
  const [traceRaceCounts, setTraceRaceCounts] = useState<Map<string, number>>(new Map());
  const [globalRaceInfo, setGlobalRaceInfo] = useState<string[]>([]);

  // Fetch global analysis (cross-trace races)
  const fetchGlobalAnalysis = useCallback(async () => {
    try {
      const response = await RacewayAPI.analyzeGlobal();
      if (response.data && response.data.anomalies) {
        setGlobalRaceInfo(response.data.anomalies);
      }
    } catch (error) {
      console.error('Error fetching global analysis:', error);
    }
  }, []);

  // Fetch race counts for all traces (for trace list indicators)
  const fetchAllRaceCounts = useCallback(async (traceIds: string[]) => {
    const raceCounts = new Map<string, number>();
    const racyTraces = new Set<string>();

    // Fetch race counts in parallel
    await Promise.all(
      traceIds.map(async (traceId) => {
        try {
          const analysis = await RacewayAPI.analyzeTrace(traceId);
          if (analysis.data && analysis.data.potential_races) {
            raceCounts.set(traceId, analysis.data.potential_races);
            if (analysis.data.potential_races > 0) {
              racyTraces.add(traceId);
            }
          }
        } catch (error) {
          console.error(`Error fetching race count for trace ${traceId}:`, error);
        }
      })
    );

    setTraceRaceCounts(raceCounts);
    setTracesWithRaces(racyTraces);
  }, []);

  // Fetch traces list
  const fetchTraces = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await RacewayAPI.getTraces();
      if (response.data) {
        setTraces(response.data.trace_ids);
        setStatus(`Connected | Events: ${response.data.total_events} | Traces: ${response.data.total_traces}`);

        // Fetch race counts for all traces (for indicators)
        fetchAllRaceCounts(response.data.trace_ids);
      }
      // Fetch global analysis when traces are loaded
      fetchGlobalAnalysis();
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setRefreshing(false);
    }
  }, [fetchGlobalAnalysis, fetchAllRaceCounts]);

  // Check audit trails for races
  const checkAuditTrailRaces = useCallback(async (traceId: string, events: Event[]) => {
    const variables = new Set<string>();

    // Extract all variables from StateChange events
    for (const event of events) {
      if (typeof event.kind === 'object' && 'StateChange' in event.kind) {
        const stateChange = event.kind.StateChange;
        variables.add(stateChange.variable);
      }
    }

    // Check each variable's audit trail for races
    const auditTrailRaces: string[] = [];
    for (const variable of Array.from(variables)) {
      try {
        const response = await RacewayAPI.getAuditTrail(traceId, variable);
        if (response.data) {
          const racyAccesses = response.data.accesses.filter(access => access.is_race);
          if (racyAccesses.length > 0) {
            auditTrailRaces.push(
              `⚠️ Race condition detected on variable "${variable}" (${racyAccesses.length} racy ${racyAccesses.length === 1 ? 'access' : 'accesses'})`
            );
          }
        }
      } catch (error) {
        console.error(`Error checking audit trail for ${variable}:`, error);
      }
    }

    return auditTrailRaces;
  }, []);

  // Fetch trace details
  const fetchTraceDetails = useCallback(async (traceId: string) => {
    setLoading(true);
    try {
      const [traceData, analysisData, criticalPath, anomalies] = await Promise.all([
        RacewayAPI.getTrace(traceId),
        RacewayAPI.analyzeTrace(traceId),
        RacewayAPI.getCriticalPath(traceId),
        RacewayAPI.getAnomalies(traceId),
      ]);

      if (traceData.data) {
        setEvents(traceData.data.events);

        // Check audit trails for races (runs in background)
        checkAuditTrailRaces(traceId, traceData.data.events).then(auditRaces => {
          setRaceInfo(prev => {
            const analyzeRaces = analysisData.data?.anomalies || [];
            const combined = [...analyzeRaces, ...auditRaces];
            if (combined.length > 0) {
              setTracesWithRaces(prevTraces => new Set(prevTraces).add(traceId));
            }
            return combined;
          });
        });
      }

      if (analysisData.data) {
        setRaceCount(analysisData.data.potential_races || 0);
        setRaceInfo(analysisData.data.anomalies || []);
        if (analysisData.data.potential_races && analysisData.data.potential_races > 0) {
          setTracesWithRaces(prev => new Set(prev).add(traceId));
        }
      }

      if (criticalPath.data) {
        setCriticalPathData(criticalPath.data);
      }

      if (anomalies.data) {
        setAnomaliesData(anomalies.data);
      }
    } catch (error) {
      console.error('Error fetching trace details:', error);
    } finally {
      setLoading(false);
    }
  }, [checkAuditTrailRaces]);

  // Fetch audit trail for a variable
  const fetchAuditTrail = useCallback(async (traceId: string, variable: string) => {
    try {
      const response = await RacewayAPI.getAuditTrail(traceId, variable);
      if (response.data) {
        setAuditTrailData(response.data);
      }
    } catch (error) {
      console.error('Error fetching audit trail:', error);
      setAuditTrailData(null);
    }
  }, []);

  // Handle variable selection for audit trail
  const handleVariableChange = useCallback((variable: string) => {
    setSelectedVariable(variable);
    if (selectedTraceId) {
      fetchAuditTrail(selectedTraceId, variable);
    }
  }, [selectedTraceId, fetchAuditTrail]);

  // Fetch view-specific data
  const fetchViewData = useCallback(async (traceId: string, view: ViewMode) => {
    try {
      switch (view) {
        case 'dependencies':
          if (!dependenciesData) {
            const response = await RacewayAPI.getDependencies(traceId);
            if (response.data) {
              setDependenciesData(response.data);
            }
          }
          break;
        case 'audit-trail':
          if (selectedVariable) {
            await fetchAuditTrail(traceId, selectedVariable);
          }
          break;
      }
    } catch (error) {
      console.error('Error fetching view data:', error);
    }
  }, [dependenciesData, selectedVariable, fetchAuditTrail]);

  // Auto-refresh effect
  useEffect(() => {
    fetchTraces();
    const interval = autoRefresh ? setInterval(fetchTraces, 20000) : null;
    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh, fetchTraces]);

  // Handle trace selection
  useEffect(() => {
    if (selectedTraceId) {
      // Clear only data that needs to be refetched
      setDependenciesData(null);
      setAuditTrailData(null);
      setSelectedVariable(null);
      // Fetch trace details (includes critical path and anomalies)
      fetchTraceDetails(selectedTraceId);
    }
  }, [selectedTraceId, fetchTraceDetails]);

  // Fetch view-specific data when view changes
  useEffect(() => {
    if (selectedTraceId) {
      fetchViewData(selectedTraceId, viewMode);
    }
  }, [selectedTraceId, viewMode, fetchViewData]);

  const handleTraceSelect = (traceId: string) => {
    setSelectedTraceId(traceId);
    setSelectedEventId(null);
  };

  const handleEventSelect = (eventId: string) => {
    setSelectedEventId(eventId);
  };

  const selectedEvent = events.find(e => e.id === selectedEventId);

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onNavigate: (tab) => setViewMode(tab),
    onRefresh: fetchTraces,
    selectedTraceId,
    traces,
    onTraceSelect: handleTraceSelect,
  });

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="flex items-center justify-between px-6 py-2.5">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-medium flex items-center gap-2">
              <img src={logo} alt="Raceway" className="w-5 h-5" />
              <span className="text-red-500">raceway</span>
            </h1>
          </div>

          <div className="flex items-center gap-2">
            {/* Race & Anomaly Pills */}
            {selectedTraceId && raceCount > 0 && (
              <Badge
                variant="destructive"
                className="font-mono text-[10px] font-normal border-0"
              >
                Races: {raceCount}
              </Badge>
            )}
            {selectedTraceId && (anomaliesData?.anomaly_count || 0) > 0 && (
              <Badge
                variant="default"
                className="font-mono text-[10px] font-normal border-0 bg-orange-500/10 text-orange-400"
              >
                Anomalies: {anomaliesData?.anomaly_count}
              </Badge>
            )}
            <Badge variant={status.includes('Connected') ? 'secondary' : 'destructive'} className="font-mono text-[10px] font-normal border-0">
              {status}
            </Badge>
            <Button
              onClick={fetchTraces}
              variant="ghost"
              size="sm"
              className="h-7 text-xs cursor-pointer"
              disabled={refreshing}
            >
              {refreshing ? (
                <>
                  <Loader2 className="w-3 h-3 mr-1.5 animate-spin" />
                  Refreshing...
                </>
              ) : (
                'Refresh'
              )}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 text-xs cursor-pointer"
              onClick={() => setAutoRefresh(!autoRefresh)}
            >
              Auto: {autoRefresh ? 'ON' : 'OFF'}
            </Button>
            {/* Export Menu */}
            {selectedTraceId && events.length > 0 && (
              <ExportMenu
                traceId={selectedTraceId}
                events={events}
                criticalPathData={criticalPathData}
                anomaliesData={anomaliesData}
                dependenciesData={dependenciesData}
                raceCount={raceCount}
              />
            )}
            <ThemeToggle />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left Sidebar - Traces */}
        <aside className="w-64 border-r border-border bg-card/30">
          <div className="h-[calc(100dvh-4.5rem)] overflow-y-auto p-3">
            <h2 className="text-[11px] font-medium text-muted-foreground mb-2 px-2 tracking-wide">TRACES</h2>
            <TraceList
              traces={traces}
              selectedTraceId={selectedTraceId}
              tracesWithRaces={tracesWithRaces}
              traceRaceCounts={traceRaceCounts}
              onSelect={handleTraceSelect}
            />
          </div>
        </aside>

        {/* Middle Panel - Main View */}
        <main className="flex-1 flex flex-col overflow-hidden">
          <Tabs value={viewMode} onValueChange={(v) => setViewMode(v as ViewMode)} className="flex-1 flex flex-col">
            <TabsList className="w-full justify-start rounded-none border-b border-border/50 bg-transparent p-0 h-auto">
              <TabsTrigger value="overview" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                Overview
              </TabsTrigger>
              <TabsTrigger value="events" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs flex items-center gap-1.5">
                Events
                {events.length > 0 && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-muted-foreground/20">
                    {events.length}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="audit-trail" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                Debugger
              </TabsTrigger>
              <TabsTrigger value="anomalies" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs flex items-center gap-1.5">
                Anomalies
                {(anomaliesData?.anomaly_count || 0) > 0 && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-orange-500/20 text-orange-300">
                    {anomaliesData?.anomaly_count}
                  </span>
                )}
              </TabsTrigger>
              <TabsTrigger value="critical-path" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                Critical Path
              </TabsTrigger>
              <TabsTrigger value="dependencies" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                Dependencies
              </TabsTrigger>
            </TabsList>

            <div className="flex-1 overflow-hidden bg-background/50">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-muted-foreground text-sm">Loading...</div>
                </div>
              ) : !selectedTraceId ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-8">
                  <h3 className="text-base font-medium mb-1.5">No trace selected</h3>
                  <p className="text-muted-foreground text-sm">Select a trace from the list to view its events</p>
                </div>
              ) : (
                <>
                  <TabsContent value="overview" className="h-full m-0 p-0">
                    <OverviewTab
                      events={events}
                      criticalPathData={criticalPathData}
                      anomaliesData={anomaliesData}
                      raceCount={raceCount}
                      onViewEvents={() => setViewMode('events')}
                      onNavigate={(tab) => setViewMode(tab as ViewMode)}
                    />
                  </TabsContent>
                  <TabsContent value="events" className="h-full m-0 p-0">
                    <EventsTabWithSwitcher
                      events={events}
                      selectedEventId={selectedEventId}
                      onEventSelect={handleEventSelect}
                      criticalPathData={criticalPathData}
                      anomaliesData={anomaliesData}
                      raceCount={raceCount}
                    />
                  </TabsContent>
                  <TabsContent value="audit-trail" className="h-full m-0 p-0">
                    <AuditTrailView
                      data={auditTrailData}
                      onVariableChange={handleVariableChange}
                      events={events}
                      onTraceSelect={handleTraceSelect}
                    />
                  </TabsContent>
                  <TabsContent value="anomalies" className="h-full m-0 p-0">
                    <AnomaliesTab data={anomaliesData} />
                  </TabsContent>
                  <TabsContent value="critical-path" className="h-full m-0 p-0">
                    <CriticalPathView data={criticalPathData} events={events} />
                  </TabsContent>
                  <TabsContent value="dependencies" className="h-full m-0 p-0">
                    <DependenciesView data={dependenciesData} />
                  </TabsContent>
                </>
              )}
            </div>
          </Tabs>
        </main>

        {/* Right Sidebar - Details (only show on Events tab) */}
        {viewMode === 'events' && (
          <aside className="w-96 border-l border-border bg-card/30 flex flex-col">
            <div className="flex-1 border-b border-border">
              <div className="py-1.5 px-2.5 border-b border-border bg-card/50">
                <h3 className="text-xs font-medium">Event Details</h3>
              </div>
              <div className="h-[calc(50dvh-4rem)] overflow-y-auto px-2.5 py-1.5">
                <EventDetails event={selectedEvent} />
              </div>
            </div>

            <div className="flex-1">
              <div className="py-1.5 px-2.5 border-b border-border bg-card/50">
                <h3 className="text-xs font-medium">Analysis</h3>
              </div>
              <div className="h-[calc(50dvh-4rem)] overflow-y-auto px-2.5 py-1.5">
                <RaceConditions raceInfo={raceInfo} anomaliesData={anomaliesData} />
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
