/**
 * Raceway - Causal Debugger View
 *
 * View component for displaying causal debugger view.
 *
 * @package Raceway
 * @date 2025-10-29
 */

import React, { useState, useEffect, useCallback } from 'react';
import { Event } from '@/types';
import { DebuggerControls } from './DebuggerControls';
import { DebuggerTimeline } from './DebuggerTimeline';
import { StateChangesPanel } from './StateChangesPanel';

interface CausalDebuggerViewProps {
  events: Event[];
}

export function CausalDebuggerView({ events }: CausalDebuggerViewProps) {
  // Sort events by timestamp
  const sortedEvents = React.useMemo(() => {
    return [...events].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );
  }, [events]);

  // State
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [playbackSpeed, setPlaybackSpeed] = useState(1);

  // Current event
  const currentEvent = sortedEvents[currentIndex] || null;
  const currentEventId = currentEvent?.id || null;

  // Playback interval
  useEffect(() => {
    if (!isPlaying) return;

    const interval = 1000 / playbackSpeed; // Adjust interval based on speed
    const timer = setInterval(() => {
      setCurrentIndex((prev) => {
        if (prev >= sortedEvents.length - 1) {
          setIsPlaying(false); // Stop at end
          return prev;
        }
        return prev + 1;
      });
    }, interval);

    return () => clearInterval(timer);
  }, [isPlaying, playbackSpeed, sortedEvents.length]);

  // Control handlers
  const handleStepBack = useCallback(() => {
    setCurrentIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const handleStepForward = useCallback(() => {
    setCurrentIndex((prev) => Math.min(sortedEvents.length - 1, prev + 1));
  }, [sortedEvents.length]);

  const handleJumpToStart = useCallback(() => {
    setCurrentIndex(0);
    setIsPlaying(false);
  }, []);

  const handleJumpToEnd = useCallback(() => {
    setCurrentIndex(sortedEvents.length - 1);
    setIsPlaying(false);
  }, [sortedEvents.length]);

  const handleTogglePlayback = useCallback(() => {
    setIsPlaying((prev) => !prev);
  }, []);

  const handleSpeedChange = useCallback((speed: number) => {
    setPlaybackSpeed(speed);
  }, []);

  const handleScrub = useCallback((index: number) => {
    setCurrentIndex(index);
    setIsPlaying(false); // Stop playback when manually scrubbing
  }, []);

  const handleEventClick = useCallback((eventId: string) => {
    const index = sortedEvents.findIndex(e => e.id === eventId);
    if (index !== -1) {
      setCurrentIndex(index);
      setIsPlaying(false);
    }
  }, [sortedEvents]);

  return (
    <div className="h-full flex flex-col overflow-hidden gap-4">
      {/* Controls - Static at top */}
      <div className="flex-shrink-0">
        <DebuggerControls
          currentIndex={currentIndex}
          totalEvents={sortedEvents.length}
          isPlaying={isPlaying}
          playbackSpeed={playbackSpeed}
          onStepBack={handleStepBack}
          onStepForward={handleStepForward}
          onJumpToStart={handleJumpToStart}
          onJumpToEnd={handleJumpToEnd}
          onTogglePlayback={handleTogglePlayback}
          onSpeedChange={handleSpeedChange}
          onScrub={handleScrub}
        />
      </div>

      {/* Timeline - Scrollable middle (independent scroll) */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0">
        <DebuggerTimeline
          events={sortedEvents}
          currentEventId={currentEventId}
          onEventClick={handleEventClick}
        />
      </div>

      {/* State Panel - Static at bottom */}
      <div className="flex-shrink-0">
        <StateChangesPanel currentEvent={currentEvent} />
      </div>
    </div>
  );
}
