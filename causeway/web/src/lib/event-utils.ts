/**
 * Event parsing and utility functions
 */

import type { Event } from '../types';

export interface ParsedEventKind {
  display: string;
  category: string;
}

/**
 * Parse event kind to extract display string and category
 * Handles both string kinds and complex object kinds
 */
export function parseEventKind(kind: Event['kind']): ParsedEventKind {
  if (typeof kind === 'string') {
    return { display: kind, category: kind };
  }

  const keys = Object.keys(kind);
  if (keys.length === 0) {
    return { display: 'Unknown', category: 'Unknown' };
  }

  const key = keys[0];
  const value = kind[key];

  if (typeof value === 'object' && value !== null) {
    // StateChange - extract access type
    if (key === 'StateChange' && value.access_type) {
      return {
        display: `StateChange | ${value.access_type}`,
        category: `StateChange:${value.access_type}`
      };
    }

    // HttpRequest - show method and URL
    if (key === 'HttpRequest') {
      const method = value.method || 'GET';
      const url = value.url || value.path || 'unknown';
      return {
        display: `HttpRequest | ${method} ${url}`,
        category: 'HttpRequest'
      };
    }

    // HttpResponse - show status code
    if (key === 'HttpResponse') {
      const status = value.status || value.status_code || '200';
      return {
        display: `HttpResponse | ${status}`,
        category: 'HttpResponse'
      };
    }

    // FunctionCall - show function name
    if (key === 'FunctionCall') {
      const funcName = value.function_name || value.name || 'unknown';
      return {
        display: `FunctionCall | ${funcName}`,
        category: 'FunctionCall'
      };
    }

    // LockAcquire - show lock type and ID
    if (key === 'LockAcquire') {
      const lockType = value.lock_type || 'Mutex';
      const lockId = value.lock_id || 'unknown';
      return {
        display: `LockAcquire | ${lockType} | ${lockId}`,
        category: 'LockAcquire'
      };
    }

    // LockRelease - show lock type and ID
    if (key === 'LockRelease') {
      const lockType = value.lock_type || 'Mutex';
      const lockId = value.lock_id || 'unknown';
      return {
        display: `LockRelease | ${lockType} | ${lockId}`,
        category: 'LockRelease'
      };
    }

    // Default for nested objects
    const subKeys = Object.keys(value);
    if (subKeys.length > 0) {
      return {
        display: `${key}::${subKeys[0]}`,
        category: key
      };
    }
  }

  return { display: key, category: key };
}

/**
 * Get simple string representation of event kind
 */
export function getEventKindString(kind: Event['kind']): string {
  return parseEventKind(kind).display;
}

/**
 * Get event category from kind
 */
export function getEventCategory(kind: Event['kind']): string {
  return parseEventKind(kind).category;
}

/**
 * Check if an event is a StateChange event
 */
export function isStateChangeEvent(kind: Event['kind']): boolean {
  if (typeof kind === 'string') {
    return kind === 'StateChange';
  }
  return 'StateChange' in kind;
}

/**
 * Check if an event is an HTTP event (request or response)
 */
export function isHttpEvent(kind: Event['kind']): boolean {
  if (typeof kind === 'string') {
    return kind === 'HttpRequest' || kind === 'HttpResponse';
  }
  return 'HttpRequest' in kind || 'HttpResponse' in kind;
}

/**
 * Check if an event is a Lock event (acquire or release)
 */
export function isLockEvent(kind: Event['kind']): boolean {
  if (typeof kind === 'string') {
    return kind === 'LockAcquire' || kind === 'LockRelease';
  }
  return 'LockAcquire' in kind || 'LockRelease' in kind;
}

/**
 * Check if an event is a FunctionCall event
 */
export function isFunctionCallEvent(kind: Event['kind']): boolean {
  if (typeof kind === 'string') {
    return kind === 'FunctionCall';
  }
  return 'FunctionCall' in kind;
}

/**
 * Extract details from an event kind (returns the nested object)
 */
export function extractEventKindDetails(kind: Event['kind']): any {
  if (typeof kind === 'string') {
    return null;
  }

  const keys = Object.keys(kind);
  if (keys.length === 0) {
    return null;
  }

  return kind[keys[0]];
}

/**
 * Get HTTP method from an HttpRequest event
 */
export function getHttpMethod(kind: Event['kind']): string | null {
  if (typeof kind !== 'object' || !('HttpRequest' in kind)) {
    return null;
  }

  const details = kind.HttpRequest;
  if (typeof details === 'object' && details !== null) {
    return details.method || 'GET';
  }

  return null;
}

/**
 * Get HTTP status code from an HttpResponse event
 */
export function getHttpStatus(kind: Event['kind']): number | null {
  if (typeof kind !== 'object' || !('HttpResponse' in kind)) {
    return null;
  }

  const details = kind.HttpResponse;
  if (typeof details === 'object' && details !== null) {
    return details.status || details.status_code || 200;
  }

  return null;
}

/**
 * Get variable name from a StateChange event
 */
export function getVariableName(kind: Event['kind']): string | null {
  if (typeof kind !== 'object' || !('StateChange' in kind)) {
    return null;
  }

  const details = kind.StateChange;
  if (typeof details === 'object' && details !== null) {
    return details.variable || null;
  }

  return null;
}

/**
 * Get lock ID from a Lock event
 */
export function getLockId(kind: Event['kind']): string | null {
  if (typeof kind !== 'object') {
    return null;
  }

  const lockDetails = kind.LockAcquire || kind.LockRelease;
  if (typeof lockDetails === 'object' && lockDetails !== null) {
    return lockDetails.lock_id || null;
  }

  return null;
}
