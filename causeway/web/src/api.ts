import {
  TracesListResponse,
  TraceResponse,
  AnalysisResponse,
  CriticalPathResponse,
  AnomaliesResponse,
  DependenciesResponse,
  AuditTrailResponse,
  FullTraceAnalysisResponse,
  DistributedTraceAnalysisResponse,
  ServicesListResponse,
  ServiceDependenciesResponse,
} from './types';

const API_BASE = '';  // Empty because we're using Vite proxy

export class RacewayAPI {
  private static async fetchJSON<T>(url: string): Promise<T> {
    // Note: In dev mode, headers are added by Vite proxy (see vite.config.ts)
    // The proxy reads from RACEWAY_KEY environment variable
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  }

  // ===== ACTIVE ENDPOINTS =====

  static async getTraces(page: number = 1, pageSize: number = 20): Promise<TracesListResponse> {
    return this.fetchJSON<TracesListResponse>(`${API_BASE}/api/traces?page=${page}&page_size=${pageSize}`);
  }

  static async getFullTraceAnalysis(traceId: string): Promise<FullTraceAnalysisResponse> {
    return this.fetchJSON<FullTraceAnalysisResponse>(`${API_BASE}/api/traces/${traceId}`);
  }

  static async analyzeGlobal(): Promise<AnalysisResponse> {
    return this.fetchJSON<AnalysisResponse>(`${API_BASE}/api/analyze/global`);
  }

  static async getServices(): Promise<ServicesListResponse> {
    return this.fetchJSON<ServicesListResponse>(`${API_BASE}/api/services`);
  }

  static async getServiceDependencies(serviceName: string): Promise<ServiceDependenciesResponse> {
    return this.fetchJSON<ServiceDependenciesResponse>(`${API_BASE}/api/services/${serviceName}/dependencies`);
  }
}
