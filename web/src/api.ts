import {
  TracesListResponse,
  AnalysisResponse,
  FullTraceAnalysisResponse,
  ServicesListResponse,
  ServiceDependenciesResponse,
  DistributedEdgesResponse,
  GlobalRacesResponse,
  SystemHotspotsResponse,
  ServiceHealthResponse,
  ServiceTracesResponse,
  PerformanceMetricsResponse,
} from './types';

const API_BASE = '';  // Empty because we're using Vite proxy

export class RacewayAPI {
  private static async fetchJSON<T>(url: string, signal?: AbortSignal): Promise<T> {
    // Note: In dev mode, headers are added by Vite proxy (see vite.config.ts)
    // The proxy reads from RACEWAY_KEY environment variable
    const response = await fetch(url, { signal });
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  }

  // ===== ACTIVE ENDPOINTS =====

  static async getTraces(page: number = 1, pageSize: number = 20, minEvents?: number): Promise<TracesListResponse> {
    const minEventsParam = minEvents ? `&min_events=${minEvents}` : '';
    return this.fetchJSON<TracesListResponse>(`${API_BASE}/api/traces?page=${page}&page_size=${pageSize}${minEventsParam}`);
  }

  static async getFullTraceAnalysis(traceId: string, signal?: AbortSignal): Promise<FullTraceAnalysisResponse> {
    return this.fetchJSON<FullTraceAnalysisResponse>(`${API_BASE}/api/traces/${traceId}`, signal);
  }

  static async analyzeGlobal(): Promise<AnalysisResponse> {
    return this.fetchJSON<AnalysisResponse>(`${API_BASE}/api/analyze/global`);
  }

  static async getServices(): Promise<ServicesListResponse> {
    return this.fetchJSON<ServicesListResponse>(`${API_BASE}/api/services`);
  }

  static async getServiceDependencies(serviceName: string): Promise<ServiceDependenciesResponse> {
    return this.fetchJSON<ServiceDependenciesResponse>(`${API_BASE}/api/services/${encodeURIComponent(serviceName)}/dependencies`);
  }

  static async getDistributedEdges(): Promise<DistributedEdgesResponse> {
    return this.fetchJSON<DistributedEdgesResponse>(`${API_BASE}/api/distributed/edges`);
  }

  static async getGlobalRaces(): Promise<GlobalRacesResponse> {
    return this.fetchJSON<GlobalRacesResponse>(`${API_BASE}/api/distributed/global-races`);
  }

  static async getSystemHotspots(): Promise<SystemHotspotsResponse> {
    return this.fetchJSON<SystemHotspotsResponse>(`${API_BASE}/api/distributed/hotspots`);
  }

  static async getServiceHealth(timeWindowMinutes: number = 60): Promise<ServiceHealthResponse> {
    return this.fetchJSON<ServiceHealthResponse>(`${API_BASE}/api/services/health?time_window_minutes=${timeWindowMinutes}`);
  }

  static async getServiceTraces(serviceName: string, page: number = 1, pageSize: number = 100): Promise<ServiceTracesResponse> {
    return this.fetchJSON<ServiceTracesResponse>(`${API_BASE}/api/services/${encodeURIComponent(serviceName)}/traces?page=${page}&page_size=${pageSize}`);
  }

  static async getPerformanceMetrics(limit: number = 50): Promise<PerformanceMetricsResponse> {
    return this.fetchJSON<PerformanceMetricsResponse>(`${API_BASE}/api/performance/metrics?limit=${limit}`);
  }
}
