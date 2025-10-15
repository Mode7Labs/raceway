import { useState, useEffect, useCallback } from 'react';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Play, Pause, SkipBack, SkipForward, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface TimelineScrubberProps {
  totalSteps: number;
  currentStep: number;
  onStepChange: (step: number) => void;
  stepLabels?: string[]; // Optional labels for each step
  isPlaying: boolean;
  onPlayPause: () => void;
  playbackSpeed?: number; // Speed multiplier (1 = 1 step per second)
}

export function TimelineScrubber({
  totalSteps,
  currentStep,
  onStepChange,
  stepLabels,
  isPlaying,
  onPlayPause,
  playbackSpeed = 1,
}: TimelineScrubberProps) {
  const [isDragging, setIsDragging] = useState(false);

  // Auto-advance when playing
  useEffect(() => {
    if (!isPlaying || currentStep >= totalSteps - 1) return;

    const interval = setInterval(() => {
      onStepChange(Math.min(currentStep + 1, totalSteps - 1));
    }, 1000 / playbackSpeed);

    return () => clearInterval(interval);
  }, [isPlaying, currentStep, totalSteps, playbackSpeed, onStepChange]);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Don't capture if user is typing in an input
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return;
      }

      switch (e.key) {
        case 'ArrowLeft':
          e.preventDefault();
          onStepChange(Math.max(0, currentStep - 1));
          break;
        case 'ArrowRight':
          e.preventDefault();
          onStepChange(Math.min(totalSteps - 1, currentStep + 1));
          break;
        case ' ':
          e.preventDefault();
          onPlayPause();
          break;
        case 'Home':
          e.preventDefault();
          onStepChange(0);
          break;
        case 'End':
          e.preventDefault();
          onStepChange(totalSteps - 1);
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [currentStep, totalSteps, onStepChange, onPlayPause]);

  const handleSliderChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    onStepChange(parseInt(e.target.value, 10));
  };

  const handleSliderMouseDown = () => {
    setIsDragging(true);
  };

  const handleSliderMouseUp = () => {
    setIsDragging(false);
  };

  const goToStart = () => onStepChange(0);
  const goToEnd = () => onStepChange(totalSteps - 1);
  const stepBackward = () => onStepChange(Math.max(0, currentStep - 1));
  const stepForward = () => onStepChange(Math.min(totalSteps - 1, currentStep + 1));

  const percentage = totalSteps > 1 ? (currentStep / (totalSteps - 1)) * 100 : 0;

  return (
    <Card className="border-primary/20 bg-card/50">
      <CardContent className="p-4">
        <div className="space-y-3">
          {/* Progress Bar */}
          <div className="relative">
            <div className="relative h-2 bg-muted rounded-full overflow-hidden">
              <div
                className="absolute h-full bg-primary transition-all duration-100"
                style={{ width: `${percentage}%` }}
              />
            </div>
            <input
              type="range"
              min="0"
              max={Math.max(0, totalSteps - 1)}
              value={currentStep}
              onChange={handleSliderChange}
              onMouseDown={handleSliderMouseDown}
              onMouseUp={handleSliderMouseUp}
              className="absolute inset-0 w-full h-2 opacity-0 cursor-pointer"
            />
          </div>

          {/* Controls */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={goToStart}
                disabled={currentStep === 0}
                className="h-7 w-7 p-0"
                title="Go to start (Home)"
              >
                <SkipBack className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={stepBackward}
                disabled={currentStep === 0}
                className="h-7 w-7 p-0"
                title="Step backward (←)"
              >
                <ChevronLeft className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant={isPlaying ? "default" : "outline"}
                size="sm"
                onClick={onPlayPause}
                className="h-7 w-7 p-0"
                title={isPlaying ? "Pause (Space)" : "Play (Space)"}
              >
                {isPlaying ? (
                  <Pause className="h-3.5 w-3.5" />
                ) : (
                  <Play className="h-3.5 w-3.5" />
                )}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={stepForward}
                disabled={currentStep >= totalSteps - 1}
                className="h-7 w-7 p-0"
                title="Step forward (→)"
              >
                <ChevronRight className="h-3.5 w-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={goToEnd}
                disabled={currentStep >= totalSteps - 1}
                className="h-7 w-7 p-0"
                title="Go to end (End)"
              >
                <SkipForward className="h-3.5 w-3.5" />
              </Button>
            </div>

            {/* Step Counter */}
            <div className="flex items-center gap-3">
              <span className="text-xs text-muted-foreground">
                Step <span className="font-mono font-semibold text-foreground">{currentStep + 1}</span>
                {' / '}
                <span className="font-mono">{totalSteps}</span>
              </span>
              {stepLabels && stepLabels[currentStep] && (
                <span className="text-xs font-mono text-primary truncate max-w-xs" title={stepLabels[currentStep]}>
                  {stepLabels[currentStep]}
                </span>
              )}
            </div>
          </div>

          {/* Keyboard Shortcuts Help */}
          <div className="text-[10px] text-muted-foreground flex items-center gap-3">
            <span>⌨️ Shortcuts:</span>
            <span><kbd className="px-1 py-0.5 bg-muted rounded">←</kbd> / <kbd className="px-1 py-0.5 bg-muted rounded">→</kbd> Step</span>
            <span><kbd className="px-1 py-0.5 bg-muted rounded">Space</kbd> Play/Pause</span>
            <span><kbd className="px-1 py-0.5 bg-muted rounded">Home</kbd> / <kbd className="px-1 py-0.5 bg-muted rounded">End</kbd> Jump</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
