/**
 * Raceway - debugger-layout
 *
 * Timeline layout algorithm for the causal debugger visualization.
 *
 * @package Raceway
 * @date 2025-10-29
 */

import { Event } from '../types';

/**
 * Layout data structures for the debugger timeline
 */

export interface TimelineNode {
  id: string;
  event: Event;
  x: number; // Horizontal position (time-based)
  y: number; // Vertical position (swimlane-based)
  laneIndex: number; // Which swimlane this belongs to
}

export interface TimelineEdge {
  source: string; // Event ID
  target: string; // Event ID
  type: 'parent' | 'causal';
  path: string; // SVG path string for bezier curve
}

export interface Swimlane {
  id: string; // Thread ID
  label: string; // Thread display name
  events: TimelineNode[];
  y: number; // Y position of this lane
}

export interface TimelineLayout {
  nodes: TimelineNode[];
  edges: TimelineEdge[];
  swimlanes: Swimlane[];
  width: number; // Total timeline width
  height: number; // Total timeline height
  timeScale: (timestamp: Date) => number; // Function to convert time to X position
}

/**
 * Compute timeline layout from events
 */
export function computeTimelineLayout(
  events: Event[],
  containerWidth: number = 2000
): TimelineLayout {
  if (events.length === 0) {
    return {
      nodes: [],
      edges: [],
      swimlanes: [],
      width: containerWidth,
      height: 0,
      timeScale: () => 0,
    };
  }

  // Sort events by timestamp
  const sortedEvents = [...events].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Get time range
  const startTime = new Date(sortedEvents[0].timestamp).getTime();
  const endTime = new Date(sortedEvents[sortedEvents.length - 1].timestamp).getTime();
  const timeRange = endTime - startTime || 1; // Avoid division by zero

  // Create time scale function (timestamp -> X pixel position)
  const padding = 50;
  const usableWidth = containerWidth - padding * 2;
  const timeScale = (timestamp: Date) => {
    const t = timestamp.getTime();
    return padding + ((t - startTime) / timeRange) * usableWidth;
  };

  // Group events by thread ID into swimlanes
  const threadMap = new Map<string, Event[]>();
  for (const event of sortedEvents) {
    const threadId = event.metadata.thread_id;
    if (!threadMap.has(threadId)) {
      threadMap.set(threadId, []);
    }
    threadMap.get(threadId)!.push(event);
  }

  // Create swimlanes
  const laneHeight = 80;
  const laneSpacing = 20;
  const swimlanes: Swimlane[] = [];
  const nodes: TimelineNode[] = [];

  let laneIndex = 0;
  for (const [threadId, threadEvents] of threadMap.entries()) {
    const y = laneIndex * (laneHeight + laneSpacing) + laneHeight / 2;
    const laneNodes: TimelineNode[] = [];

    for (const event of threadEvents) {
      const node: TimelineNode = {
        id: event.id,
        event,
        x: timeScale(new Date(event.timestamp)),
        y,
        laneIndex,
      };
      laneNodes.push(node);
      nodes.push(node);
    }

    swimlanes.push({
      id: threadId,
      label: getThreadLabel(threadId),
      events: laneNodes,
      y,
    });

    laneIndex++;
  }

  // Compute causal edges
  const edges = computeCausalEdges(nodes, sortedEvents);

  // Calculate total height
  const height = swimlanes.length * (laneHeight + laneSpacing);

  return {
    nodes,
    edges,
    swimlanes,
    width: containerWidth,
    height,
    timeScale,
  };
}

/**
 * Compute causal edges between events using happens-before relationships
 */
function computeCausalEdges(nodes: TimelineNode[], events: Event[]): TimelineEdge[] {
  const edges: TimelineEdge[] = [];
  const nodeMap = new Map(nodes.map(n => [n.id, n]));

  for (const event of events) {
    const targetNode = nodeMap.get(event.id);
    if (!targetNode) continue;

    // Add parent edge (direct structural relationship)
    if (event.parent_id) {
      const sourceNode = nodeMap.get(event.parent_id);
      if (sourceNode) {
        edges.push({
          source: sourceNode.id,
          target: targetNode.id,
          type: 'parent',
          path: createEdgePath(sourceNode, targetNode),
        });
      }
    }

    // Add causal edges (happens-before from vector clocks)
    // Find events that causally precede this one
    for (const otherEvent of events) {
      if (otherEvent.id === event.id) continue;
      if (otherEvent.id === event.parent_id) continue; // Skip parent (already added)

      if (happensBefore(otherEvent, event)) {
        // Check for transitive reduction - only add direct causal links
        const hasIntermediate = events.some(intermediate => {
          return (
            intermediate.id !== otherEvent.id &&
            intermediate.id !== event.id &&
            happensBefore(otherEvent, intermediate) &&
            happensBefore(intermediate, event)
          );
        });

        if (!hasIntermediate) {
          const sourceNode = nodeMap.get(otherEvent.id);
          if (sourceNode) {
            edges.push({
              source: sourceNode.id,
              target: targetNode.id,
              type: 'causal',
              path: createEdgePath(sourceNode, targetNode),
            });
          }
        }
      }
    }
  }

  return edges;
}

/**
 * Check if event A happens-before event B using vector clocks
 */
function happensBefore(eventA: Event, eventB: Event): boolean {
  const vecA = new Map(eventA.causality_vector);
  const vecB = new Map(eventB.causality_vector);

  // Collect all keys from both vectors
  const allKeys = new Set([...vecA.keys(), ...vecB.keys()]);

  let hasLessThan = false;

  for (const key of allKeys) {
    const valA = vecA.get(key) || 0;
    const valB = vecB.get(key) || 0;

    if (valA > valB) {
      return false; // A cannot happen before B
    }
    if (valA < valB) {
      hasLessThan = true;
    }
  }

  return hasLessThan;
}

/**
 * Create SVG path for edge (cubic bezier curve)
 */
function createEdgePath(source: TimelineNode, target: TimelineNode): string {
  const x1 = source.x;
  const y1 = source.y;
  const x2 = target.x;
  const y2 = target.y;

  // Control points for smooth curve
  const dx = x2 - x1;

  // Horizontal bias for time-flow
  const cx1 = x1 + dx * 0.5;
  const cy1 = y1;
  const cx2 = x1 + dx * 0.5;
  const cy2 = y2;

  return `M ${x1} ${y1} C ${cx1} ${cy1}, ${cx2} ${cy2}, ${x2} ${y2}`;
}

/**
 * Get short thread label for display
 */
function getThreadLabel(threadId: string): string {
  // Extract meaningful part of thread ID
  if (threadId.includes('::')) {
    const parts = threadId.split('::');
    return parts[parts.length - 1];
  }

  // Truncate long IDs
  if (threadId.length > 16) {
    return threadId.substring(0, 13) + '...';
  }

  return threadId;
}

/**
 * Get state changes for a specific event
 */
export interface StateChange {
  variable: string;
  oldValue: string | null;
  newValue: string;
  accessType: string;
  isWrite: boolean;
  isLock: boolean;
}

export function getStateChangesForEvent(event: Event): StateChange[] {
  const changes: StateChange[] = [];

  // Check if this is a StateChange event
  if (event.kind.StateChange) {
    const { variable, old_value, new_value, access_type } = event.kind.StateChange;
    changes.push({
      variable,
      oldValue: old_value || null,
      newValue: new_value,
      accessType: access_type,
      isWrite: access_type.includes('Write'),
      isLock: false,
    });
  }

  // Check for lock operations
  if (event.kind.LockAcquire) {
    const lockId = event.kind.LockAcquire.lock_id || 'unknown';
    changes.push({
      variable: lockId,
      oldValue: null,
      newValue: 'acquired',
      accessType: 'LockAcquire',
      isWrite: false,
      isLock: true,
    });
  }

  if (event.kind.LockRelease) {
    const lockId = event.kind.LockRelease.lock_id || 'unknown';
    changes.push({
      variable: lockId,
      oldValue: 'acquired',
      newValue: 'released',
      accessType: 'LockRelease',
      isWrite: false,
      isLock: true,
    });
  }

  return changes;
}
