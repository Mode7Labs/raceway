/**
 * Raceway - Debugger Timeline
 *
 * Debugger Timeline component for the Raceway application.
 *
 * @package Raceway
 * @date 2025-10-29
 */

import { useMemo, useRef, useEffect } from 'react';
import { Event } from '../../../types';
import {
  computeTimelineLayout,
  TimelineNode,
  TimelineEdge,
} from '../../../lib/debugger-layout';
import { getEventKindString } from '../../../lib/event-utils';

interface DebuggerTimelineProps {
  events: Event[];
  currentEventId: string | null;
  onEventClick: (eventId: string) => void;
}

export function DebuggerTimeline({
  events,
  currentEventId,
  onEventClick,
}: DebuggerTimelineProps) {
  const containerRef = useRef<HTMLDivElement>(null);

  // Compute timeline layout
  const layout = useMemo(() => {
    return computeTimelineLayout(events, 2000);
  }, [events]);

  // Auto-scroll to current event
  useEffect(() => {
    if (!currentEventId || !containerRef.current) return;

    const currentNode = layout.nodes.find(n => n.id === currentEventId);
    if (!currentNode) return;

    // Scroll to center the current event
    const container = containerRef.current;
    const targetX = currentNode.x - container.clientWidth / 2;
    const targetY = currentNode.y - container.clientHeight / 2;

    container.scrollTo({
      left: Math.max(0, targetX),
      top: Math.max(0, targetY),
      behavior: 'smooth',
    });
  }, [currentEventId, layout]);

  if (events.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-zinc-500">
        <p>No events to display</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-full overflow-auto bg-zinc-950 border border-zinc-800 rounded-lg"
    >
      <svg
        width={layout.width}
        height={layout.height + 50}
        className="block"
      >
        {/* Swimlane backgrounds */}
        {layout.swimlanes.map((lane, idx) => (
          <g key={lane.id}>
            {/* Lane background */}
            <rect
              x={0}
              y={lane.y - 40}
              width={layout.width}
              height={80}
              fill={idx % 2 === 0 ? '#09090b' : '#18181b'}
              opacity={0.5}
            />

            {/* Lane label */}
            <text
              x={10}
              y={lane.y}
              className="text-xs fill-zinc-500"
              dominantBaseline="middle"
            >
              {lane.label}
            </text>

            {/* Lane separator */}
            <line
              x1={0}
              y1={lane.y + 40}
              x2={layout.width}
              y2={lane.y + 40}
              stroke="#27272a"
              strokeWidth={1}
            />
          </g>
        ))}

        {/* Causal edges */}
        <g className="edges">
          {layout.edges.map((edge, idx) => (
            <Edge
              key={`edge-${idx}`}
              edge={edge}
              isHighlighted={
                edge.source === currentEventId || edge.target === currentEventId
              }
            />
          ))}
        </g>

        {/* Event nodes */}
        <g className="nodes">
          {layout.nodes.map((node) => (
            <EventNode
              key={node.id}
              node={node}
              isSelected={node.id === currentEventId}
              onClick={onEventClick}
            />
          ))}
        </g>
      </svg>
    </div>
  );
}

/**
 * Individual event node
 */
interface EventNodeProps {
  node: TimelineNode;
  isSelected: boolean;
  onClick: (eventId: string) => void;
}

function EventNode({ node, isSelected, onClick }: EventNodeProps) {
  const eventType = getEventKindString(node.event.kind);

  // Determine node color based on event type
  let fillColor = '#71717a'; // zinc-500 default
  if (eventType.toLowerCase().includes('write')) {
    fillColor = '#ef4444'; // red-500
  } else if (eventType.toLowerCase().includes('read')) {
    fillColor = '#6b7280'; // gray-500
  } else if (eventType.toLowerCase().includes('lock')) {
    fillColor = '#f59e0b'; // amber-500
  }

  const radius = isSelected ? 8 : 6;
  const strokeWidth = isSelected ? 3 : 1;

  return (
    <g
      className="cursor-pointer transition-all hover:opacity-100"
      onClick={() => onClick(node.id)}
      opacity={isSelected ? 1 : 0.8}
    >
      {/* Outer glow for selected */}
      {isSelected && (
        <circle
          cx={node.x}
          cy={node.y}
          r={radius + 8}
          fill="none"
          stroke="#3b82f6"
          strokeWidth={2}
          opacity={0.3}
          className="animate-pulse"
        />
      )}

      {/* Node circle */}
      <circle
        cx={node.x}
        cy={node.y}
        r={radius}
        fill={fillColor}
        stroke={isSelected ? '#3b82f6' : '#27272a'}
        strokeWidth={strokeWidth}
      />

      {/* Tooltip on hover */}
      <title>
        {eventType}
        {'\n'}
        {node.event.metadata.location || 'No location'}
        {'\n'}
        Thread: {node.event.metadata.thread_id}
      </title>
    </g>
  );
}

/**
 * Causal edge between events
 */
interface EdgeProps {
  edge: TimelineEdge;
  isHighlighted: boolean;
}

function Edge({ edge, isHighlighted }: EdgeProps) {
  const isCausal = edge.type === 'causal';

  // Styling based on edge type
  let stroke = '#52525b'; // zinc-600
  let strokeWidth = 1;
  let opacity = 0.3;
  let strokeDasharray = 'none';

  if (isHighlighted) {
    stroke = '#3b82f6'; // blue-500
    strokeWidth = 2;
    opacity = 0.8;
  } else if (isCausal) {
    stroke = '#a855f7'; // purple-500
    strokeDasharray = '5,3';
    opacity = 0.4;
  }

  return (
    <>
      {/* Edge path */}
      <path
        d={edge.path}
        fill="none"
        stroke={stroke}
        strokeWidth={strokeWidth}
        opacity={opacity}
        strokeDasharray={strokeDasharray}
      />

      {/* Arrowhead */}
      <marker
        id={`arrow-${edge.type}-${isHighlighted ? 'highlighted' : 'normal'}`}
        viewBox="0 0 10 10"
        refX="5"
        refY="5"
        markerWidth="4"
        markerHeight="4"
        orient="auto"
      >
        <path
          d="M 0 0 L 10 5 L 0 10 z"
          fill={stroke}
          opacity={opacity}
        />
      </marker>
    </>
  );
}
