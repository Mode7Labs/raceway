import {
  TracesListResponse,
  TraceResponse,
  AnalysisResponse,
  CriticalPathResponse,
  AnomaliesResponse,
  DependenciesResponse,
  AuditTrailResponse,
} from './types';

const API_BASE = '';  // Empty because we're using Vite proxy

export class RacewayAPI {
  private static async fetchJSON<T>(url: string): Promise<T> {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }
    return response.json();
  }

  static async getTraces(): Promise<TracesListResponse> {
    return this.fetchJSON<TracesListResponse>(`${API_BASE}/api/traces`);
  }

  static async getTrace(traceId: string): Promise<TraceResponse> {
    return this.fetchJSON<TraceResponse>(`${API_BASE}/api/traces/${traceId}`);
  }

  static async analyzeTrace(traceId: string): Promise<AnalysisResponse> {
    return this.fetchJSON<AnalysisResponse>(`${API_BASE}/api/traces/${traceId}/analyze`);
  }

  static async getCriticalPath(traceId: string): Promise<CriticalPathResponse> {
    return this.fetchJSON<CriticalPathResponse>(`${API_BASE}/api/traces/${traceId}/critical-path`);
  }

  static async getAnomalies(traceId: string): Promise<AnomaliesResponse> {
    return this.fetchJSON<AnomaliesResponse>(`${API_BASE}/api/traces/${traceId}/anomalies`);
  }

  static async getDependencies(traceId: string): Promise<DependenciesResponse> {
    return this.fetchJSON<DependenciesResponse>(`${API_BASE}/api/traces/${traceId}/dependencies`);
  }

  static async getAuditTrail(traceId: string, variable: string): Promise<AuditTrailResponse> {
    return this.fetchJSON<AuditTrailResponse>(`${API_BASE}/api/traces/${traceId}/audit-trail/${encodeURIComponent(variable)}`);
  }
}
