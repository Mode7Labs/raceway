/**
 * Time and date formatting utilities
 */

/**
 * Format a timestamp as a relative time string (e.g., "5m ago", "2h ago")
 */
export function formatTimeAgo(timestamp: string): string {
  const now = new Date();
  const then = new Date(timestamp);
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

/**
 * Format a timestamp as a human-readable string
 */
export function formatTimestamp(timestamp: string): string {
  const date = new Date(timestamp);
  return date.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

/**
 * Format a duration in nanoseconds to a human-readable string
 */
export function formatDuration(durationNs: number | null | undefined): string {
  if (durationNs === null || durationNs === undefined) {
    return 'N/A';
  }

  // Convert nanoseconds to milliseconds
  const ms = durationNs / 1_000_000;

  if (ms < 1) {
    // Show in microseconds
    const us = durationNs / 1_000;
    return `${us.toFixed(2)}μs`;
  }

  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  }

  // Convert to seconds
  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }

  // Convert to minutes
  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${minutes.toFixed(2)}m`;
  }

  // Convert to hours
  const hours = minutes / 60;
  return `${hours.toFixed(2)}h`;
}

/**
 * Format milliseconds to a human-readable string
 */
export function formatDurationMs(ms: number): string {
  if (ms < 1) {
    return `${(ms * 1000).toFixed(2)}μs`;
  }

  if (ms < 1000) {
    return `${ms.toFixed(2)}ms`;
  }

  const seconds = ms / 1000;
  if (seconds < 60) {
    return `${seconds.toFixed(2)}s`;
  }

  const minutes = seconds / 60;
  if (minutes < 60) {
    return `${minutes.toFixed(2)}m`;
  }

  const hours = minutes / 60;
  return `${hours.toFixed(2)}h`;
}

/**
 * Get time elapsed between two timestamps in milliseconds
 */
export function getElapsedTime(start: string, end: string): number {
  const startTime = new Date(start).getTime();
  const endTime = new Date(end).getTime();
  return endTime - startTime;
}

/**
 * Format a timestamp as ISO 8601 string
 */
export function toISOString(timestamp: string | Date): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  return date.toISOString();
}
