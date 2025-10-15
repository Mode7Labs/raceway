import { useState, useEffect, useCallback } from 'react';
import { RacewayAPI } from './api';
import {type ViewMode, type Event, type AnomaliesData, type CriticalPathData, type DependenciesData, type AuditTrailData } from './types';
import { TraceList } from './components/TraceList';
import { EventsView } from './components/EventsView';
import { TreeView } from './components/TreeView';
import { CriticalPathView } from './components/CriticalPathView';
import { AnomaliesView } from './components/AnomaliesView';
import { DependenciesView } from './components/DependenciesView';
import { AuditTrailView } from './components/AuditTrailView';
import { EventDetails } from './components/EventDetails';
import { RaceConditions } from './components/RaceConditions';
import { ThemeToggle } from './components/theme-toggle';
import './App.css';

export default function App() {
  const [traces, setTraces] = useState<string[]>([]);
  const [selectedTraceId, setSelectedTraceId] = useState<string | null>(null);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('events');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState('Connecting...');

  // Data caches
  const [events, setEvents] = useState<Event[]>([]);
  const [anomaliesData, setAnomaliesData] = useState<AnomaliesData | null>(null);
  const [criticalPathData, setCriticalPathData] = useState<CriticalPathData | null>(null);
  const [dependenciesData, setDependenciesData] = useState<DependenciesData | null>(null);
  const [auditTrailData, setAuditTrailData] = useState<AuditTrailData | null>(null);
  const [selectedVariable, setSelectedVariable] = useState<string | null>(null);
  const [raceInfo, setRaceInfo] = useState<string[]>([]);
  const [tracesWithRaces, setTracesWithRaces] = useState<Set<string>>(new Set());

  // Fetch traces list
  const fetchTraces = useCallback(async () => {
    try {
      const response = await RacewayAPI.getTraces();
      if (response.data) {
        setTraces(response.data.trace_ids);
        setStatus(`Connected | Events: ${response.data.total_events} | Traces: ${response.data.total_traces}`);
      }
    } catch (error) {
      setStatus(`Error: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }, []);

  // Fetch trace details
  const fetchTraceDetails = useCallback(async (traceId: string) => {
    setLoading(true);
    try {
      const [traceData, analysisData] = await Promise.all([
        RacewayAPI.getTrace(traceId),
        RacewayAPI.analyzeTrace(traceId),
      ]);

      if (traceData.data) {
        setEvents(traceData.data.events);
      }

      if (analysisData.data) {
        setRaceInfo(analysisData.data.anomalies);
        if (analysisData.data.potential_races > 0) {
          setTracesWithRaces(prev => new Set(prev).add(traceId));
        }
      }
    } catch (error) {
      console.error('Error fetching trace details:', error);
    } finally {
      setLoading(false);
    }
  }, []);

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
        case 'critical-path':
          if (!criticalPathData) {
            const response = await RacewayAPI.getCriticalPath(traceId);
            if (response.data) {
              setCriticalPathData(response.data);
            }
          }
          break;
        case 'anomalies':
          if (!anomaliesData) {
            const response = await RacewayAPI.getAnomalies(traceId);
            if (response.data) {
              setAnomaliesData(response.data);
            }
          }
          break;
        case 'dependencies':
          if (!dependenciesData) {
            const response = await RacewayAPI.getDependencies(traceId);
            if (response.data) {
              setDependenciesData(response.data);
            }
          }
          break;
        case 'audit-trail':
          // Audit trail needs a variable - keep existing data if we have one
          if (selectedVariable) {
            await fetchAuditTrail(traceId, selectedVariable);
          }
          break;
      }
    } catch (error) {
      console.error('Error fetching view data:', error);
    }
  }, [anomaliesData, criticalPathData, dependenciesData, selectedVariable, fetchAuditTrail]);

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
      fetchTraceDetails(selectedTraceId);
      setCriticalPathData(null);
      setAnomaliesData(null);
      setDependenciesData(null);
      setAuditTrailData(null);
      setSelectedVariable(null);
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

  return (
    <div className="app">
      <header className="header">
        <h1>
          <span>🏁</span>
          Raceway - Causal Debugger
        </h1>
        <div className="header-controls">
          <span className={`status ${status.includes('Connected') ? 'connected' : ''}`}>
            {status}
          </span>
          <button onClick={fetchTraces}>Refresh</button>
          <button
            className={autoRefresh ? 'active' : ''}
            onClick={() => setAutoRefresh(!autoRefresh)}
          >
            Auto-refresh: {autoRefresh ? 'ON' : 'OFF'}
          </button>
          <ThemeToggle />
        </div>
      </header>

      <main className="main">
        <TraceList
          traces={traces}
          selectedTraceId={selectedTraceId}
          tracesWithRaces={tracesWithRaces}
          onSelect={handleTraceSelect}
        />

        <div className="middle-panel">
          <div className="view-tabs">
            <button
              className={`view-tab ${viewMode === 'events' ? 'active' : ''}`}
              onClick={() => setViewMode('events')}
            >
              Events
            </button>
            <button
              className={`view-tab ${viewMode === 'tree' ? 'active' : ''}`}
              onClick={() => setViewMode('tree')}
            >
              Tree
            </button>
            <button
              className={`view-tab ${viewMode === 'critical-path' ? 'active' : ''}`}
              onClick={() => setViewMode('critical-path')}
            >
              Critical Path
            </button>
            <button
              className={`view-tab ${viewMode === 'anomalies' ? 'active' : ''}`}
              onClick={() => setViewMode('anomalies')}
            >
              Anomalies
            </button>
            <button
              className={`view-tab ${viewMode === 'dependencies' ? 'active' : ''}`}
              onClick={() => setViewMode('dependencies')}
            >
              Dependencies
            </button>
            <button
              className={`view-tab ${viewMode === 'audit-trail' ? 'active' : ''}`}
              onClick={() => setViewMode('audit-trail')}
            >
              Audit Trail
            </button>
          </div>

          <div className="view-content">
            {loading ? (
              <div className="loading">Loading...</div>
            ) : !selectedTraceId ? (
              <div className="empty-state">
                <h3>No trace selected</h3>
                <p>Select a trace from the list to view its events</p>
              </div>
            ) : (
              <>
                {viewMode === 'events' && (
                  <EventsView
                    events={events}
                    selectedEventId={selectedEventId}
                    onEventSelect={handleEventSelect}
                  />
                )}
                {viewMode === 'tree' && (
                  <TreeView
                    events={events}
                    selectedEventId={selectedEventId}
                    onEventSelect={handleEventSelect}
                  />
                )}
                {viewMode === 'critical-path' && (
                  <CriticalPathView data={criticalPathData} />
                )}
                {viewMode === 'anomalies' && (
                  <AnomaliesView data={anomaliesData} />
                )}
                {viewMode === 'dependencies' && (
                  <DependenciesView data={dependenciesData} />
                )}
                {viewMode === 'audit-trail' && (
                  <AuditTrailView
                    data={auditTrailData}
                    onVariableChange={handleVariableChange}
                  />
                )}
              </>
            )}
          </div>
        </div>

        <div className="details-panel">
          <div className="panel-header">Event Details</div>
          <EventDetails event={selectedEvent} />

          <div className="panel-header">Race Conditions & Anomalies</div>
          <RaceConditions anomalies={raceInfo} />
        </div>
      </main>
    </div>
  );
}
