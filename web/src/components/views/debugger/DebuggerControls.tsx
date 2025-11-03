/**
 * Raceway - Debugger Controls
 *
 * Debugger Controls component for the Raceway application.
 *
 * @package Raceway
 * @date 2025-10-29
 */

import React, { useEffect, useRef, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import {
  Play,
  Pause,
  SkipBack,
  SkipForward,
  ChevronsLeft,
  ChevronsRight
} from 'lucide-react';

interface DebuggerControlsProps {
  currentIndex: number;
  totalEvents: number;
  isPlaying: boolean;
  playbackSpeed: number;
  onStepBack: () => void;
  onStepForward: () => void;
  onJumpToStart: () => void;
  onJumpToEnd: () => void;
  onTogglePlayback: () => void;
  onSpeedChange: (speed: number) => void;
  onScrub: (index: number) => void;
}

export function DebuggerControls({
  currentIndex,
  totalEvents,
  isPlaying,
  playbackSpeed,
  onStepBack,
  onStepForward,
  onJumpToStart,
  onJumpToEnd,
  onTogglePlayback,
  onSpeedChange,
  onScrub,
}: DebuggerControlsProps) {
  const scrubberRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          onStepBack();
          break;
        case 'ArrowRight':
          e.preventDefault();
          onStepForward();
          break;
        case ' ':
          e.preventDefault();
          onTogglePlayback();
          break;
        case 'Home':
          e.preventDefault();
          onJumpToStart();
          break;
        case 'End':
          e.preventDefault();
          onJumpToEnd();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onStepBack, onStepForward, onTogglePlayback, onJumpToStart, onJumpToEnd]);

  // Handle scrubber drag
  const handleScrubberMouseDown = useCallback((e: React.MouseEvent) => {
    isDraggingRef.current = true;
    updateScrubPosition(e.clientX);
  }, []);

  const handleScrubberMouseMove = useCallback((e: MouseEvent) => {
    if (isDraggingRef.current) {
      updateScrubPosition(e.clientX);
    }
  }, []);

  const handleScrubberMouseUp = useCallback(() => {
    isDraggingRef.current = false;
  }, []);

  const updateScrubPosition = (clientX: number) => {
    if (!scrubberRef.current) return;

    const rect = scrubberRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(clientX - rect.left, rect.width));
    const percent = x / rect.width;
    const index = Math.round(percent * (totalEvents - 1));
    onScrub(index);
  };

  useEffect(() => {
    document.addEventListener('mousemove', handleScrubberMouseMove);
    document.addEventListener('mouseup', handleScrubberMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleScrubberMouseMove);
      document.removeEventListener('mouseup', handleScrubberMouseUp);
    };
  }, [handleScrubberMouseMove, handleScrubberMouseUp]);

  const progress = totalEvents > 0 ? (currentIndex / (totalEvents - 1)) * 100 : 0;

  return (
    <div className="flex-shrink-0 bg-transparent px-3 pt-2 pb-6">
      {/* Stepper Controls */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-1">
          {/* Jump to Start */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onJumpToStart}
            disabled={currentIndex === 0}
            className="h-7 w-7 p-0"
            title="Jump to Start (Home)"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>

          {/* Step Back */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onStepBack}
            disabled={currentIndex === 0}
            className="h-7 w-7 p-0"
            title="Step Back (←)"
          >
            <SkipBack className="h-3.5 w-3.5" />
          </Button>

          {/* Play/Pause */}
          <Button
            variant="default"
            size="sm"
            onClick={onTogglePlayback}
            disabled={totalEvents === 0}
            className="h-7 w-7 p-0"
            title={isPlaying ? 'Pause (Space)' : 'Play (Space)'}
          >
            {isPlaying ? (
              <Pause className="h-3.5 w-3.5" />
            ) : (
              <Play className="h-3.5 w-3.5" />
            )}
          </Button>

          {/* Step Forward */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onStepForward}
            disabled={currentIndex >= totalEvents - 1}
            className="h-7 w-7 p-0"
            title="Step Forward (→)"
          >
            <SkipForward className="h-3.5 w-3.5" />
          </Button>

          {/* Jump to End */}
          <Button
            variant="ghost"
            size="sm"
            onClick={onJumpToEnd}
            disabled={currentIndex >= totalEvents - 1}
            className="h-7 w-7 p-0"
            title="Jump to End (End)"
          >
            <ChevronsRight className="h-3.5 w-3.5" />
          </Button>
        </div>

        {/* Event Counter */}
        <div className="flex items-center gap-4">
          <span className="text-sm text-zinc-400">
            Event <span className="font-semibold text-zinc-50">{currentIndex + 1}</span> of{' '}
            <span className="text-zinc-300">{totalEvents}</span>
          </span>

          {/* Speed Control */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500">Speed:</span>
            <select
              value={playbackSpeed}
              onChange={(e) => onSpeedChange(Number(e.target.value))}
              className="text-xs bg-zinc-800 text-zinc-300 border border-zinc-700 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value={0.5}>0.5x</option>
              <option value={1}>1x</option>
              <option value={2}>2x</option>
              <option value={4}>4x</option>
            </select>
          </div>
        </div>
      </div>

      {/* Timeline Scrubber */}
      <div className="relative">
        <div
          ref={scrubberRef}
          onMouseDown={handleScrubberMouseDown}
          className="relative h-2 bg-zinc-800 rounded-full cursor-pointer overflow-hidden"
        >
          {/* Progress Bar */}
          <div
            className="absolute inset-y-0 left-0 bg-blue-500 rounded-full transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Tick Marks (show every 10th event for large traces) */}
        {totalEvents > 10 && (
          <div className="absolute inset-x-0 top-full mt-2 mb-2 flex justify-between text-[10px] text-zinc-600">
            <span>0</span>
            <span>{Math.floor(totalEvents / 2)}</span>
            <span>{totalEvents - 1}</span>
          </div>
        )}
      </div>
    </div>
  );
}
