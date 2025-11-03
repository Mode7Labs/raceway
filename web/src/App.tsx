import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { RacewayAPI } from './api';
import {type SidebarMode, type SystemViewMode, type InsightsViewMode, type ViewMode, type ServiceViewMode, type Event, type AnomaliesData, type CriticalPathData, type DependenciesData, type VariableAccess, type TraceMetadata, type ServiceListItem } from './types';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { TraceList } from './components/features/traces/TraceList';
import { ServiceList } from './components/features/services/ServiceList';
import { EventsTabWithSwitcher } from './components/features/events/EventsTabWithSwitcher';
import { CausalDebuggerView } from './components/views/debugger/CausalDebuggerView';
import { CriticalPathView } from './components/views/traces/CriticalPathView';
import { DependenciesView } from './components/views/analysis/DependenciesView';
import { AuditTrailView } from './components/views/audit/AuditTrailView';
import { EventDetails } from './components/features/events/EventDetails';
import { ThemeToggle } from './components/layout/ThemeToggle';
import { ExportMenu } from './components/shared/ExportMenu';
import { Button } from './components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from './components/ui/tabs';
import { Badge } from './components/ui/badge';
import { OverviewTab } from './components/views/dashboard/OverviewTab';
import { AnomaliesTab } from './components/views/traces/AnomaliesTab';
import { ServiceOverview } from './components/features/services/ServiceOverview';
import { ServiceDependencies } from './components/features/services/ServiceDependencies';
import { ServiceTraces } from './components/features/services/ServiceTraces';
import { ServiceDependencyGraph } from './components/features/services/ServiceDependencyGraph';
import { SystemPerformance } from './components/features/system/SystemPerformance';
import { SystemHealth } from './components/features/system/SystemHealth';
import { GlobalRaces } from './components/features/system/GlobalRaces';
import { SystemHotspots } from './components/features/system/SystemHotspots';
import { Dashboard } from './components/views/dashboard/Dashboard';
import { Login } from './components/auth/Login';
import { Loader2 } from 'lucide-react';
import logo from './static/icon.png';

export default function App() {
  const navigate = useNavigate();
  const location = useLocation();

  // Authentication state
  const [authChecked, setAuthChecked] = useState(false);
  const [authenticated, setAuthenticated] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);

  // Check authentication status on mount
  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await fetch('/auth/check');
        const data = await response.json();
        setAuthenticated(data.authenticated);
        setAuthRequired(data.auth_required);
      } catch (err) {
        // If check fails, assume no auth required (backward compatible)
        setAuthenticated(true);
        setAuthRequired(false);
      } finally {
        setAuthChecked(true);
      }
    };

    checkAuth();
  }, []);

  // Handle successful login
  const handleLogin = () => {
    setAuthenticated(true);
  };

  // Show loading while checking auth
  if (!authChecked) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  // Show login if auth is required and user is not authenticated
  if (authRequired && !authenticated) {
    return <Login onLogin={handleLogin} />;
  }

  const [traces, setTraces] = useState<TraceMetadata[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [sidebarMode, setSidebarMode] = useState<SidebarMode>('system');
  const [systemViewMode, setSystemViewMode] = useState<SystemViewMode>('insights');
  const [insightsViewMode, setInsightsViewMode] = useState<InsightsViewMode>('dashboard');
  const [viewMode, setViewMode] = useState<ViewMode>('overview');
  const [selectedServiceName, setSelectedServiceName] = useState<string | null>(null);
  const [serviceViewMode, setServiceViewMode] = useState<ServiceViewMode>('overview');
  const [services, setServices] = useState<ServiceListItem[]>([]);
  const [servicesLoading, setServicesLoading] = useState(false);
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState('Connecting...');
  const [error, setError] = useState<string | null>(null);
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

  // Track which trace we're currently loading to prevent race conditions
  const loadingTraceIdRef = useRef<string | null>(null);

  // Global analysis (cross-trace races) is available at /api/analyze/global
  // but is not currently displayed in UI, so we don't fetch it
  // TODO: Add UI for global cross-trace race detection

  // Fetch services list
  const fetchServices = useCallback(async () => {
    setServicesLoading(true);
    try {
      const response = await RacewayAPI.getServices();
      if (response.data) {
        setServices(response.data.services);
      }
    } catch (error) {
      console.error('Error fetching services:', error);
    } finally {
      setServicesLoading(false);
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
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    } finally {
      setRefreshing(false);
    }
  }, []);

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
  const fetchTraceDetails = useCallback(async (traceId: string, options: { silent?: boolean; signal?: AbortSignal } = {}) => {
    const silent = options.silent ?? false;

    // Mark this trace as the one we're loading
    loadingTraceIdRef.current = traceId;

    if (!silent) {
      setLoading(true);
      setError(null);
    }

    try {
      // Single API call to fetch all trace data
      const fullAnalysis = await RacewayAPI.getFullTraceAnalysis(traceId, options.signal);

      // Only update state if this is still the trace we should be showing
      if (loadingTraceIdRef.current !== traceId) {
        return; // Stale response, ignore it
      }

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
      setError(null);
    } catch (error) {
      // Ignore AbortError - this is expected when switching traces quickly
      if (error instanceof Error && error.name === 'AbortError') {
        return;
      }

      // Only set error if this is still the current trace
      if (loadingTraceIdRef.current === traceId) {
        console.error('Error fetching trace details:', error);
        const errorMessage = error instanceof Error ? error.message : 'Failed to fetch trace details';
        setError(errorMessage);
      }
    } finally {
      // Only clear loading if this is still the current trace
      if (!silent && loadingTraceIdRef.current === traceId) {
        setLoading(false);
      }
    }
  }, []);

  // Note: No more lazy loading! All data is fetched upfront via /full endpoint

  // Auto-refresh effect
  useEffect(() => {
    fetchTraces();
    fetchServices();
    if (selectedTraceId) {
      fetchTraceDetails(selectedTraceId, { silent: true });
    }

    const interval = autoRefresh ? setInterval(() => {
      fetchTraces();
      fetchServices();
      if (selectedTraceId) {
        fetchTraceDetails(selectedTraceId, { silent: true });
      }
    }, 20000) : null;

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [autoRefresh, fetchTraces, fetchServices, fetchTraceDetails, selectedTraceId]);

  // Handle trace selection with abort controller to prevent race conditions
  useEffect(() => {
    if (selectedTraceId) {
      // Create abort controller for this fetch
      const abortController = new AbortController();

      // Clear data before refetching
      setDependenciesData(null);
      setAuditTrails({});
      setCriticalPathData(null);
      setAnomaliesData(null);

      // Fetch ALL trace details in one call (no lazy loading!)
      fetchTraceDetails(selectedTraceId, { signal: abortController.signal });

      // Cleanup: abort the request if selectedTraceId changes or component unmounts
      return () => {
        abortController.abort();
      };
    }
  }, [selectedTraceId, fetchTraceDetails]);

  const handleTraceSelect = (traceId: string) => {
    setSelectedTraceId(traceId);
    setSelectedEventId(null);
    navigateToTrace(traceId);
  };

  const handleEventSelect = (eventId: string) => {
    setSelectedEventId(eventId);
    if (selectedTraceId) {
      const basePath =
        viewMode === 'overview'
          ? `/traces/${selectedTraceId}`
          : `/traces/${selectedTraceId}/${viewMode}`;
      const path = viewMode === 'events' ? `${basePath}/${eventId}` : basePath;
      navigate(path);
    }
  };

  const handleServiceSelect = (serviceName: string | null) => {
    setSelectedServiceName(serviceName);
    setServiceViewMode('overview'); // Reset to overview when service changes
  };

  // Navigation helper functions for contextual linking
  const navigateToTrace = useCallback((traceId: string) => {
    navigate(`/traces/${traceId}`);
  }, [navigate]);

  const navigateToService = useCallback((serviceName: string) => {
    navigate(`/services/${encodeURIComponent(serviceName)}`);
  }, [navigate]);

  const navigateToServiceTraces = useCallback((serviceName: string) => {
    navigate(`/services/${encodeURIComponent(serviceName)}/traces`);
  }, [navigate]);

  const navigateToServiceDependencies = useCallback((serviceName: string) => {
    navigate(`/services/${encodeURIComponent(serviceName)}/dependencies`);
  }, [navigate]);

  const navigateToVariable = useCallback((variableName: string, traceId?: string) => {
    if (traceId) {
      navigate(`/traces/${traceId}/variables`);
    } else {
      // Navigate to hotspots page when clicking on a variable without a trace context
      navigate('/insights/hotspots');
    }
  }, [navigate]);

  const navigateToDashboard = useCallback(() => {
    navigate('/');
  }, [navigate]);

  const navigateToRaces = useCallback(() => {
    navigate('/insights/races');
  }, [navigate]);

  const navigateToHotspots = useCallback(() => {
    navigate('/insights/hotspots');
  }, [navigate]);

  const navigateToDependencyGraph = useCallback(() => {
    navigate('/insights/dependency-graph');
  }, [navigate]);

  const navigateToSystemTraces = useCallback(() => {
    navigate('/');
  }, [navigate]);

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

  // Parse URL and sync to state (URL is the source of truth)
  useEffect(() => {
    const path = location.pathname;

    // Handle root path
    if (path === '/') {
      setSidebarMode('system');
      setSystemViewMode('insights');
      setInsightsViewMode('dashboard');
      setSelectedTraceId(null);
      setSelectedEventId(null);
      setSelectedServiceName(null);
      return;
    }

    // Parse /insights/:tab
    const insightsMatch = path.match(/^\/insights\/([^/]+)$/);
    if (insightsMatch) {
      const tab = insightsMatch[1] as InsightsViewMode;
      setSidebarMode('system');
      setSystemViewMode('insights');
      setInsightsViewMode(tab);
      setSelectedTraceId(null);
      setSelectedEventId(null);
      setSelectedServiceName(null);
      return;
    }

    // Parse /services/:name/:tab?
    const serviceMatch = path.match(/^\/services\/([^/]+)(?:\/([^/]+))?$/);
    if (serviceMatch) {
      const serviceName = decodeURIComponent(serviceMatch[1]);
      const tab = (serviceMatch[2] as ServiceViewMode) || 'overview';
      setSidebarMode('system');
      setSystemViewMode('services');
      setSelectedServiceName(serviceName);
      setServiceViewMode(tab);
      setSelectedTraceId(null);
      setSelectedEventId(null);
      return;
    }

    // Parse /traces/:id/:tab?/:eventId?
    const traceMatch = path.match(/^\/traces\/([^/]+)(?:\/([^/]+))?(?:\/([^/]+))?$/);
    if (traceMatch) {
      const traceId = traceMatch[1];
      const tab = (traceMatch[2] as ViewMode) || 'overview';
      const eventId = traceMatch[3] || null;
      setSidebarMode('traces');
      setSelectedTraceId(traceId);
      setViewMode(tab);
      setSelectedEventId(eventId);
      setSelectedServiceName(null);
      return;
    }
  }, [location.pathname]);

  return (
    <div className="flex flex-col h-screen bg-background text-foreground">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="flex items-center justify-between px-6 py-2.5">
          <div className="flex items-center gap-3">
            <h1 className="text-base font-medium flex items-center gap-2">
              <img src={logo} alt="Raceway" className="w-5 h-5" />
              <span className="text-red-400/60 font-black" style={{ fontFamily: "'Orbitron', sans-serif" }}>Raceway</span>
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
        {/* Left Sidebar - Mode Switcher + Content */}
        <aside className="w-64 border-r border-border bg-background">
          <div className="h-[calc(100dvh-4.5rem)] flex flex-col">
            {/* Mode Switcher */}
            <div className="p-3 border-b border-border">
              <div className="flex gap-1 p-1 bg-muted/30 rounded-md">
                <button
                  onClick={() => navigate('/')}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    sidebarMode === 'system'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  System
                </button>
                <button
                  onClick={() => {
                    // Navigate to first trace if available, otherwise just switch mode
                    if (traces.length > 0) {
                      navigate(`/traces/${traces[0].trace_id}`);
                    }
                  }}
                  className={`flex-1 px-3 py-1.5 text-xs font-medium rounded transition-colors ${
                    sidebarMode === 'traces'
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Traces
                </button>
              </div>
            </div>

            {/* Conditional Content */}
            {sidebarMode === 'system' ? (
              <>
                {/* System Sub-Navigation */}
                <div className="p-3 border-b border-border">
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => navigate('/')}
                      className={`px-3 py-2 text-xs font-medium rounded transition-colors text-left ${
                        systemViewMode === 'insights'
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      }`}
                    >
                      Insights
                    </button>
                    <button
                      onClick={() => {
                        // Navigate to first service if available
                        if (services.length > 0) {
                          navigate(`/services/${encodeURIComponent(services[0].name)}`);
                        }
                      }}
                      className={`px-3 py-2 text-xs font-medium rounded transition-colors text-left ${
                        systemViewMode === 'services'
                          ? 'bg-muted text-foreground'
                          : 'text-muted-foreground hover:text-foreground hover:bg-muted/50'
                      }`}
                    >
                      Services
                    </button>
                  </div>
                </div>

                {/* System Content */}
                {systemViewMode === 'services' && (
                  <div className="flex-1 overflow-y-auto p-3">
                    <ServiceList
                      services={services}
                      selectedServiceName={selectedServiceName}
                      onSelect={handleServiceSelect}
                      onNavigateToServiceTraces={navigateToServiceTraces}
                      loading={servicesLoading}
                    />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="p-3 border-b border-border">
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
              </>
            )}
          </div>
        </aside>

        {/* Middle Panel - Main View */}
        <main className="flex-1 flex flex-col overflow-hidden">
          {/* Conditional Rendering: System Mode or Traces Mode */}
          {sidebarMode === 'system' ? (
            systemViewMode === 'insights' ? (
              /* Insights Mode - Tabs for Dashboard, Dependency Graph, Performance, Health */
              <Tabs value={insightsViewMode} onValueChange={(v) => navigate(v === 'dashboard' ? '/' : `/insights/${v}`)} className="flex-1 flex flex-col">
                <TabsList className="w-full justify-start rounded-none border-b border-border/50 bg-transparent p-0 h-auto">
                  <TabsTrigger value="dashboard" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                    Overview
                  </TabsTrigger>
                  <TabsTrigger value="dependency-graph" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                    Dependency Graph
                  </TabsTrigger>
                  <TabsTrigger value="performance" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                    Performance
                  </TabsTrigger>
                  <TabsTrigger value="health" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                    Health
                  </TabsTrigger>
                  <TabsTrigger value="hotspots" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                    Hotspots
                  </TabsTrigger>
                  <TabsTrigger value="races" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                    Races
                  </TabsTrigger>
                </TabsList>

                <div className="flex-1 overflow-hidden bg-background/50">
                  <TabsContent value="dashboard" className="h-full m-0 p-0">
                    <Dashboard
                      onNavigateToTrace={navigateToTrace}
                      onNavigateToServices={() => {
                        setSystemViewMode('services');
                      }}
                      onNavigateToRaces={navigateToRaces}
                      onNavigateToHotspots={navigateToHotspots}
                      onNavigateToDependencyGraph={navigateToDependencyGraph}
                      onNavigateToTraces={navigateToSystemTraces}
                      onNavigateToService={navigateToService}
                      onNavigateToVariable={navigateToVariable}
                      services={services}
                      servicesLoading={servicesLoading}
                    />
                  </TabsContent>
                  <TabsContent value="dependency-graph" className="h-full m-0 p-0">
                    <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-6">
                      <ServiceDependencyGraph services={services} />
                    </div>
                  </TabsContent>
                  <TabsContent value="performance" className="h-full m-0 p-0">
                    <SystemPerformance
                      services={services.map(s => s.name)}
                      onNavigateToTrace={navigateToTrace}
                      onNavigateToService={navigateToService}
                    />
                  </TabsContent>
                  <TabsContent value="health" className="h-full m-0 p-0">
                    <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-6">
                      <SystemHealth services={services} />
                    </div>
                  </TabsContent>
                  <TabsContent value="hotspots" className="h-full m-0 p-0">
                    <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-6">
                      <SystemHotspots
                        onNavigateToService={navigateToService}
                        onNavigateToVariable={navigateToVariable}
                      />
                    </div>
                  </TabsContent>
                  <TabsContent value="races" className="h-full m-0 p-0">
                    <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-6">
                      <GlobalRaces
                        onNavigateToTrace={navigateToTrace}
                        onNavigateToVariable={navigateToVariable}
                      />
                    </div>
                  </TabsContent>
                </div>
              </Tabs>
            ) : (
              /* Services Mode - Show individual service tabs when selected */
              selectedServiceName === null ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center">
                    <h3 className="text-base font-medium mb-1.5">No service selected</h3>
                    <p className="text-muted-foreground text-sm">Select a service from the list to view details</p>
                  </div>
                </div>
              ) : (
                <Tabs value={serviceViewMode} onValueChange={(v) => navigate(v === 'overview' ? `/services/${encodeURIComponent(selectedServiceName!)}` : `/services/${encodeURIComponent(selectedServiceName!)}/${v}`)} className="flex-1 flex flex-col">
                  <TabsList className="w-full justify-start rounded-none border-b border-border/50 bg-transparent p-0 h-auto">
                    <TabsTrigger value="overview" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                      Overview
                    </TabsTrigger>
                    <TabsTrigger value="traces" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                      Traces
                    </TabsTrigger>
                    <TabsTrigger value="dependencies" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                      Dependencies
                    </TabsTrigger>
                    <TabsTrigger value="performance" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                      Performance
                    </TabsTrigger>
                  </TabsList>

                  <div className="flex-1 overflow-hidden bg-background/50">
                    <TabsContent value="overview" className="h-full m-0 p-0">
                      <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-6">
                        {(() => {
                          const service = services.find(s => s.name === selectedServiceName);
                          return service ? (
                            <ServiceOverview service={service} loading={servicesLoading} />
                          ) : (
                            <div className="flex items-center justify-center h-64">
                              <div className="text-muted-foreground">Service not found</div>
                            </div>
                          );
                        })()}
                      </div>
                    </TabsContent>
                    <TabsContent value="traces" className="h-full m-0 p-0">
                      <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-6">
                        {selectedServiceName && (
                          <ServiceTraces
                            serviceName={selectedServiceName}
                            onSelectTrace={navigateToTrace}
                            selectedTraceId={selectedTraceId}
                          />
                        )}
                      </div>
                    </TabsContent>
                    <TabsContent value="dependencies" className="h-full m-0 p-0">
                      <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-6">
                        {selectedServiceName && (
                          <ServiceDependencies
                            serviceName={selectedServiceName}
                            onNavigateToService={navigateToService}
                            onNavigateToServiceTraces={navigateToServiceTraces}
                          />
                        )}
                      </div>
                    </TabsContent>
                    <TabsContent value="performance" className="h-full m-0 p-0">
                      <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-6">
                        <div className="text-muted-foreground text-center py-12">
                          Service-level performance metrics coming soon
                        </div>
                      </div>
                    </TabsContent>
                  </div>
                </Tabs>
              )
            )
          ) : (
            /* Traces Mode */
            <Tabs value={viewMode} onValueChange={(v) => navigate(selectedTraceId ? (v === 'overview' ? `/traces/${selectedTraceId}` : `/traces/${selectedTraceId}/${v}`) : '/')} className="flex-1 flex flex-col">
              <TabsList className="w-full justify-start rounded-none border-b border-border/50 bg-transparent p-0 h-auto">
                <TabsTrigger value="overview" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                  Overview
                </TabsTrigger>
                <TabsTrigger value="debugger" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                  Debugger
                </TabsTrigger>
                <TabsTrigger value="events" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs flex items-center gap-1.5">
                  Events
                  {events.length > 0 && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-muted-foreground/20">
                      {events.length}
                    </span>
                  )}
                </TabsTrigger>
                <TabsTrigger value="performance" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                  Performance
                </TabsTrigger>
                <TabsTrigger value="variables" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs">
                  Variables
                </TabsTrigger>
                <TabsTrigger value="anomalies" className="rounded-none border-b border-transparent px-4 py-2.5 text-xs flex items-center gap-1.5">
                  Anomalies
                  {(anomaliesData?.anomaly_count || 0) > 0 && (
                    <span className="text-[10px] px-1 py-0.5 rounded bg-orange-500/20 text-orange-300">
                      {anomaliesData?.anomaly_count}
                    </span>
                  )}
                </TabsTrigger>
              </TabsList>

            <div className="flex-1 overflow-hidden bg-background/50">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-muted-foreground text-sm">Loading...</div>
                </div>
              ) : error ? (
                <div className="flex flex-col items-center justify-center h-full text-center p-8">
                  <div className="rounded-lg border border-red-500/50 bg-red-500/10 p-4 max-w-md">
                    <h3 className="text-base font-medium mb-1.5 text-red-400">Error Loading Trace</h3>
                    <p className="text-sm text-muted-foreground">{error}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-3"
                      onClick={() => selectedTraceId && fetchTraceDetails(selectedTraceId)}
                    >
                      Retry
                    </Button>
                  </div>
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
                      onNavigate={(tab) => navigate(selectedTraceId ? (tab === 'overview' ? `/traces/${selectedTraceId}` : `/traces/${selectedTraceId}/${tab}`) : '/')}
                    />
                  </TabsContent>
                  <TabsContent value="debugger" className="h-full m-0 p-0">
                    <div className="h-[calc(100dvh-5.5rem)] p-6">
                      <CausalDebuggerView events={events} />
                    </div>
                  </TabsContent>
                  <TabsContent value="events" className="h-full m-0 p-0">
                    <EventsTabWithSwitcher
                      events={events}
                      selectedEventId={selectedEventId}
                      onEventSelect={handleEventSelect}
                      criticalPathData={criticalPathData}
                      anomaliesData={anomaliesData}
                      raceCount={raceCount}
                      onNavigateToService={navigateToService}
                    />
                  </TabsContent>
                  <TabsContent value="performance" className="h-full m-0 p-0">
                    <div className="flex flex-col h-full">
                      <div className="flex-1 border-b border-border overflow-hidden">
                        <CriticalPathView data={criticalPathData} events={events} />
                      </div>
                      <div className="flex-1 overflow-hidden">
                        <DependenciesView data={dependenciesData} />
                      </div>
                    </div>
                  </TabsContent>
                  <TabsContent value="variables" className="h-full m-0 p-0">
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
                </>
              )}
            </div>
          </Tabs>
          )}
        </main>

        {/* Right Sidebar - Details (only show on Events tab when event is selected) */}
        {viewMode === 'events' && selectedEventId && (
          <aside className="w-96 border-l border-border bg-card/30 flex flex-col">
            <div className="flex-1 flex flex-col min-h-0">
              <div className="py-1.5 px-2.5 border-b border-border bg-card/50">
                <h3 className="text-xs font-medium">Event Details</h3>
              </div>
              <div className="flex-1 overflow-y-auto px-2.5 py-1.5 min-h-0">
                <EventDetails event={selectedEvent} />
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}
