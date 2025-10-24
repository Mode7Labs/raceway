import { useState, useEffect, useCallback } from 'react';
import { RacewayAPI } from './api';
import {type ViewMode, type Event, type AnomaliesData, type CriticalPathData, type DependenciesData, type VariableAccess, type TraceMetadata } from './types';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { TraceList } from './components/TraceList';
import { EventsTabWithSwitcher } from './components/EventsTabWithSwitcher';
import { CriticalPathView } from './components/CriticalPathView';
import { DependenciesView } from './components/DependenciesView';
import { AuditTrailView } from './components/AuditTrailView';
import { DistributedAnalysisView } from './components/DistributedAnalysisView';
import { EventDetails } from './components/EventDetails';
import { RaceConditions } from './components/RaceConditions';
import { ThemeToggle } from './components/theme-toggle';
import { ExportMenu } from './components/ExportMenu';
import { Button } from './components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Badge } from './components/ui/badge';
import { OverviewTab } from './components/OverviewTab';
import { AnomaliesTab } from './components/AnomaliesTab';
import { Services } from './components/Services';
import { Loader2 } from 'lucide-react';
import logo from './static/icon.png';

export default function App() {
  const [traces, setTraces] = useState<TraceMetadata[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('Connecting...');
  const [searchQuery, setSearchQuery] = useState('');
  const [currentPage, setCurrentPage] = useState(1);
  const [hasMoreTraces, setHasMoreTraces] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // Data caches
  const [events, setEvents] = useState<Event[]>([]);
  const [anomaliesData, setAnomaliesData] = useState<AnomaliesData | null>(null);
  const [criticalPathData, setCriticalPathData] = useState<CriticalPathData | null>(null);
  const [dependenciesData, setDependenciesData] = useState<DependenciesData | null>(null);
  const [auditTrails, setAuditTrails] = useState<Record<string, VariableAccess[]>>({});
  const [raceCount, setRaceCount] = useState<number>(0);
  const [raceInfo, setRaceInfo] = useState<string[]>([]);

  // Fetch global analysis (cross-trace races)
  const fetchGlobalAnalysis = useCallback(async () => {
    try {
      await RacewayAPI.analyzeGlobal();
      // Global analysis is available via API but not currently displayed in UI
    } catch (error) {
      console.error('Error fetching global analysis:', error);
    }
  }, []);

  // Fetch traces list (resets to page 1)
  const fetchTraces = useCallback(async () => {
    setRefreshing(true);
    try {
      const response = await RacewayAPI.getTraces(1, 20);
      if (response.data) {
        // Store full trace metadata
        setTraces(response.data.traces);
        setCurrentPage(1);
        setHasMoreTraces(response.data.page < response.data.total_pages);

        // Calculate total events from all traces
        const totalEvents = response.data.traces.reduce((sum, t) => sum + t.event_count, 0);
        setStatus(`Connected | Events: ${totalEvents} | Traces: ${response.data.total_traces}`);
      }
      // Fetch global analysis when traces are loaded
      fetchGlobalAnalysis();
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setRefreshing(false);
    }
  }, [fetchGlobalAnalysis]);

  // Load more traces (append next page)
  const loadMoreTraces = useCallback(async () => {
    if (loadingMore || !hasMoreTraces) return;

    setLoadingMore(true);
    try {
      const nextPage = currentPage + 1;
      const response = await RacewayAPI.getTraces(nextPage, 20);
      if (response.data && response.data.traces) {
        // Append new traces to existing list
        setTraces(prev => [...prev, ...response.data!.traces]);
        setCurrentPage(nextPage);
        setHasMoreTraces(response.data.page < response.data.total_pages);
      }
    } catch (error) {
      console.error('Error loading more traces:', error);
    } finally {
      setLoadingMore(false);
    }
  }, [currentPage, hasMoreTraces, loadingMore]);


  // Fetch trace details (optimized to use single /full endpoint)
  const fetchTraceDetails = useCallback(async (traceId: string) => {
    setLoading(true);
    try {
      // Single API call to fetch all trace data
      const fullAnalysis = await RacewayAPI.getFullTraceAnalysis(traceId);

      if (fullAnalysis.data) {
        // Extract events
        setEvents(fullAnalysis.data.events);

        // Extract race analysis
        setRaceCount(fullAnalysis.data.analysis.potential_races || 0);
        setRaceInfo(fullAnalysis.data.analysis.anomalies || []);

        // Extract critical path (if available)
        if (fullAnalysis.data.critical_path) {
          setCriticalPathData(fullAnalysis.data.critical_path);
        }

        // Extract anomalies (if available)
        if (fullAnalysis.data.anomalies && fullAnalysis.data.anomalies.length > 0) {
          setAnomaliesData({
            trace_id: traceId,
            anomaly_count: fullAnalysis.data.anomalies.length,
            anomalies: fullAnalysis.data.anomalies,
          });
        }

        // Extract dependencies (if available)
        if (fullAnalysis.data.dependencies) {
          setDependenciesData(fullAnalysis.data.dependencies);
        }

        // Extract audit trails (pre-fetched!)
        if (fullAnalysis.data.audit_trails) {
          setAuditTrails(fullAnalysis.data.audit_trails);
        }
      }
    } catch (error) {
      console.error('Error fetching trace details:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Note: No more lazy loading! All data is fetched upfront via /full endpoint

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
      // Clear data before refetching
      setDependenciesData(null);
      setAuditTrails({});
      setCriticalPathData(null);
      setAnomaliesData(null);
      // Fetch ALL trace details in one call (no lazy loading!)
      fetchTraceDetails(selectedTraceId);
    }
  }, [selectedTraceId, fetchTraceDetails]);

  const handleTraceSelect = (traceId: string) => {
    setSelectedTraceId(traceId);
    setSelectedEventId(null);
  };

  const handleEventSelect = (eventId: string) => {
    setSelectedEventId(eventId);
  };

  const selectedEvent = events.find(e => e.id === selectedEventId);

  // Filter traces by search query
  const filteredTraces = traces.filter(trace =>
    trace.trace_id.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Keyboard shortcuts
  useKeyboardShortcuts({
    onNavigate: (tab) => setViewMode(tab),
    onRefresh: fetchTraces,
    selectedTraceId,
    traces: filteredTraces,
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
              <span className="text-red-400/60 font-extralight uppercase tracking-[0.25em]">raceway</span>
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
        <aside className="w-64 border-r border-border bg-background">
          <div className="h-[calc(100dvh-4.5rem)] flex flex-col">
            <div className="p-3 border-b border-border">
              <div className="text-[10px] font-medium text-muted-foreground/70 mb-2 px-2 tracking-wider uppercase">
                Traces
              </div>
              <input
                type="text"
                placeholder="Search by ID..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full px-3 py-1.5 text-xs bg-background border border-border rounded-md focus:outline-none focus:ring-1 focus:ring-primary/50"
              />
            </div>
            <div className="flex-1 overflow-y-auto p-3">
              <TraceList
                traces={filteredTraces}
                selectedTraceId={selectedTraceId}
                onSelect={handleTraceSelect}
                onLoadMore={loadMoreTraces}
                hasMore={hasMoreTraces && !searchQuery}
                loadingMore={loadingMore}
              />
            </div>
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
              <TabsTrigger value="distributed-analysis" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs flex items-center gap-1.5">
                Distributed Analysis
                {(() => {
                  const serviceCount = new Set(events.map(e => e.metadata.service_name)).size;
                  return serviceCount > 1 ? (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-cyan-500/20 text-cyan-300">
                      {serviceCount}
                    </span>
                  ) : null;
                })()}
              </TabsTrigger>
              <TabsTrigger value="services" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                Services
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
                      auditTrails={auditTrails}
                      events={events}
                      traceId={selectedTraceId || ''}
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
                  <TabsContent value="distributed-analysis" className="h-full m-0 p-0 overflow-auto">
                    <div className="p-6">
                      <DistributedAnalysisView
                        events={events}
                        criticalPathData={criticalPathData}
                        raceCount={raceCount}
                        selectedEventId={selectedEventId}
                        onEventSelect={handleEventSelect}
                      />
                    </div>
                  </TabsContent>
                </>
              )}
              {/* Services tab - available without trace selection */}
              <TabsContent value="services" className="h-full m-0 p-0">
                <Services />
              </TabsContent>
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
