import { Button } from './ui/button';
import { Play, Pause } from 'lucide-react';

interface TimelineScrubberProps {
  totalSteps: number;
  currentStep: number;
  onStepChange: (step: number) => void;
  stepLabels?: string[];
  isPlaying?: boolean;
  onPlayPause?: () => void;
  playbackSpeed?: number;
}

export function TimelineScrubber({
  totalSteps,
  currentStep,
  onStepChange,
  isPlaying = false,
  onPlayPause,
}: TimelineScrubberProps) {
  return (
    <div className="flex items-center gap-4">
      {onPlayPause && (
        <Button
          variant="outline"
          size="sm"
          onClick={onPlayPause}
          className="h-8 w-8 p-0"
        >
          {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
        </Button>
      )}

      <div className="flex-1 flex items-center gap-2">
        <span className="text-xs text-muted-foreground min-w-[3ch]">
          {currentStep + 1}
        </span>
        <input
          type="range"
          min={0}
          max={totalSteps - 1}
          step={1}
          value={currentStep}
          onChange={(e) => onStepChange(parseInt(e.target.value, 10))}
          className="flex-1 h-2 bg-muted rounded-lg appearance-none cursor-pointer accent-primary"
        />
        <span className="text-xs text-muted-foreground min-w-[3ch] text-right">
          {totalSteps}
        </span>
      </div>
    </div>
  );
}
