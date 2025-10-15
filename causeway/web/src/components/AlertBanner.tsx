import { useState } from 'react';
import { Button } from './ui/button';
import { cn } from '@/lib/utils';

interface AlertBannerProps {
  raceCount: number;
  anomalyCount: number;
  onViewRaces: () => void;
  onViewAnomalies: () => void;
}

export function AlertBanner({ raceCount, anomalyCount, onViewRaces, onViewAnomalies }: AlertBannerProps) {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed || (raceCount === 0 && anomalyCount === 0)) {
    return null;
  }

  const hasCriticalIssues = raceCount > 0;

  return (
    <div
      className={cn(
        "border-b px-6 py-3 flex items-center justify-between gap-4",
        hasCriticalIssues
          ? "bg-red-500/10 border-red-500/30"
          : "bg-orange-500/10 border-orange-500/30"
      )}
    >
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <span className="text-xl flex-shrink-0">⚠️</span>
        <div className="flex items-center gap-2 flex-wrap">
          {raceCount > 0 && (
            <>
              <span className="font-medium text-sm">
                {raceCount} Race Condition{raceCount > 1 ? 's' : ''} Detected
              </span>
              <Button
                onClick={onViewRaces}
                size="sm"
                variant="destructive"
                className="h-6 text-xs"
              >
                View Details
              </Button>
            </>
          )}
          {raceCount > 0 && anomalyCount > 0 && (
            <span className="text-muted-foreground">|</span>
          )}
          {anomalyCount > 0 && (
            <>
              <span className="font-medium text-sm">
                {anomalyCount} Anomal{anomalyCount > 1 ? 'ies' : 'y'}
              </span>
              <Button
                onClick={onViewAnomalies}
                size="sm"
                variant="outline"
                className="h-6 text-xs"
              >
                View
              </Button>
            </>
          )}
        </div>
      </div>
      <Button
        onClick={() => setDismissed(true)}
        variant="ghost"
        size="sm"
        className="h-6 w-6 p-0 flex-shrink-0"
      >
        ×
      </Button>
    </div>
  );
}
