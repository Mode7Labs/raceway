/**
 * Raceway - State Changes Panel
 *
 * Panel component for state changes panel.
 *
 * @package Raceway
 * @date 2025-10-29
 */

import { Event } from '@/types';
import { getStateChangesForEvent, StateChange } from '@/lib/debugger-layout';
import { getEventKindString } from '@/lib/event-utils';

interface StateChangesPanelProps {
  currentEvent: Event | null;
}

export function StateChangesPanel({ currentEvent }: StateChangesPanelProps) {
  if (!currentEvent) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500">
        <p>Select an event to see state changes</p>
      </div>
    );
  }

  const stateChanges = getStateChangesForEvent(currentEvent);
  const eventType = getEventKindString(currentEvent.kind);

  return (
    <div className="flex flex-col bg-zinc-900 border-t border-zinc-800 h-[180px]">
      {/* Header */}
      <div className="flex-shrink-0 px-3 py-1.5 border-b border-zinc-800">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold text-zinc-50">State Changes</h3>
          <span className="text-[10px] text-zinc-500">
            {currentEvent.metadata.thread_id}
          </span>
        </div>
        <div className="text-[10px] text-zinc-400">
          {eventType}
        </div>
      </div>

      {/* State Changes List */}
      <div className="flex-1 overflow-y-auto">
        {stateChanges.length === 0 ? (
          <div className="p-2 text-xs text-zinc-500">
            No state changes for this event
          </div>
        ) : (
          <div className="divide-y divide-zinc-800">
            {stateChanges.map((change, idx) => (
              <StateChangeItem key={idx} change={change} />
            ))}
          </div>
        )}
      </div>

      {/* Event Metadata */}
      <div className="flex-shrink-0 px-3 py-1.5 border-t border-zinc-800 bg-zinc-950">
        <div className="grid grid-cols-2 gap-1.5 text-[10px]">
          <div>
            <span className="text-zinc-500">Service:</span>
            <span className="ml-2 text-zinc-300">{currentEvent.metadata.service_name}</span>
          </div>
          <div>
            <span className="text-zinc-500">Thread:</span>
            <span className="ml-2 text-zinc-300 font-mono">
              {getShortThreadId(currentEvent.metadata.thread_id)}
            </span>
          </div>
          {currentEvent.metadata.location && (
            <div className="col-span-2">
              <span className="text-zinc-500">Location:</span>
              <span className="ml-2 text-zinc-300 font-mono text-[9px]">
                {currentEvent.metadata.location}
              </span>
            </div>
          )}
          {currentEvent.metadata.duration_ns && (
            <div>
              <span className="text-zinc-500">Duration:</span>
              <span className="ml-2 text-zinc-300">
                {formatDuration(currentEvent.metadata.duration_ns)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Individual state change item
 */
function StateChangeItem({ change }: { change: StateChange }) {
  const { variable, oldValue, newValue, accessType, isWrite, isLock } = change;

  // Determine icon and color
  let icon = '○';
  let iconColor = 'text-zinc-500';
  let borderColor = 'border-zinc-700';

  if (isLock) {
    icon = '🔒';
    iconColor = 'text-amber-500';
    borderColor = 'border-amber-500/30';
  } else if (isWrite) {
    icon = '🔴';
    iconColor = 'text-red-500';
    borderColor = 'border-red-500/30';
  } else if (accessType.includes('Read')) {
    icon = '🔵';
    iconColor = 'text-blue-500';
    borderColor = 'border-blue-500/30';
  }

  return (
    <div className={`p-2 hover:bg-zinc-800/50 transition-colors border-l-2 ${borderColor}`}>
      <div className="flex items-start gap-1.5">
        <span className={`text-xs ${iconColor} flex-shrink-0 mt-0.5`}>{icon}</span>
        <div className="flex-1 min-w-0">
          {/* Variable name */}
          <div className="text-xs font-medium text-zinc-200 font-mono truncate">
            {variable}
          </div>

          {/* Value change */}
          <div className="mt-0.5 flex items-center gap-1.5 text-[10px]">
            {oldValue !== null ? (
              <>
                <span className="text-zinc-500 font-mono max-w-[120px] truncate">
                  {formatValue(oldValue)}
                </span>
                <span className="text-zinc-600">→</span>
                <span className="text-zinc-300 font-mono max-w-[120px] truncate">
                  {formatValue(newValue)}
                </span>
              </>
            ) : (
              <span className="text-zinc-300 font-mono max-w-[250px] truncate">
                {formatValue(newValue)}
              </span>
            )}
          </div>

          {/* Access type */}
          <div className="mt-0.5 text-[9px] text-zinc-600 uppercase tracking-wide">
            {accessType}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * Format value for display
 */
function formatValue(value: string): string {
  // Truncate very long values
  if (value.length > 50) {
    return value.substring(0, 47) + '...';
  }
  return value;
}

/**
 * Get short thread ID for display
 */
function getShortThreadId(threadId: string): string {
  if (threadId.includes('::')) {
    const parts = threadId.split('::');
    return parts[parts.length - 1];
  }
  if (threadId.length > 12) {
    return threadId.substring(0, 9) + '...';
  }
  return threadId;
}

/**
 * Format duration from nanoseconds
 */
function formatDuration(durationNs: number): string {
  const us = durationNs / 1000;
  const ms = us / 1000;
  const s = ms / 1000;

  if (s >= 1) {
    return `${s.toFixed(2)}s`;
  }
  if (ms >= 1) {
    return `${ms.toFixed(2)}ms`;
  }
  if (us >= 1) {
    return `${us.toFixed(2)}μs`;
  }
  return `${durationNs}ns`;
}
