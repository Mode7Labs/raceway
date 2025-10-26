import { useState } from 'react';
import { Button } from './ui/button';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';

interface VectorClockDisplayProps {
  causalityVector: Array<[string, number]>;
}

export function VectorClockDisplay({ causalityVector }: VectorClockDisplayProps) {
  const [showRaw, setShowRaw] = useState(false);

  if (!causalityVector || causalityVector.length === 0) {
    return (
      <div className="text-xs text-muted-foreground italic p-2 bg-muted rounded">
        No causality information available
      </div>
    );
  }

  // Find max value for scaling
  const maxValue = Math.max(...causalityVector.map(([_, value]) => value));

  // Sort by service name for consistent display
  const sorted = [...causalityVector].sort((a, b) => a[0].localeCompare(b[0]));

  // Color palette for services (cycling through colors)
  const getServiceColor = (index: number): string => {
    const colors = [
      'bg-blue-500/80',
      'bg-purple-500/80',
      'bg-green-500/80',
      'bg-orange-500/80',
      'bg-pink-500/80',
      'bg-cyan-500/80',
      'bg-yellow-500/80',
      'bg-red-500/80',
    ];
    return colors[index % colors.length];
  };

  const formatJSON = (vector: Array<[string, number]>): string => {
    return JSON.stringify(vector, null, 2);
  };

  return (
    <div className="space-y-2">
      {/* Visual Bars */}
      <div className="space-y-2 bg-muted/50 p-3 rounded-md border border-border/30">
        {sorted.map(([service, value], index) => {
          const percentage = maxValue > 0 ? (value / maxValue) * 100 : 0;
          const minWidth = 8; // Minimum width percentage for visibility
          const barWidth = Math.max(minWidth, percentage);

          return (
            <div key={service} className="space-y-1">
              <div className="flex items-center justify-between text-[10px]">
                <span className="text-muted-foreground font-mono truncate max-w-[120px]" title={service}>
                  {service}
                </span>
                <span className="font-mono font-semibold text-foreground">
                  {value}
                </span>
              </div>
              <div className="relative h-2 bg-background/50 rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    getServiceColor(index)
                  )}
                  style={{ width: `${barWidth}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      {/* Toggle for Raw JSON */}
      <Button
        variant="ghost"
        size="sm"
        className="h-6 px-2 text-[10px] w-full justify-start text-muted-foreground hover:text-foreground"
        onClick={() => setShowRaw(!showRaw)}
      >
        {showRaw ? (
          <ChevronDown className="h-3 w-3 mr-1" />
        ) : (
          <ChevronRight className="h-3 w-3 mr-1" />
        )}
        {showRaw ? 'Hide' : 'Show'} Raw Vector
      </Button>

      {/* Raw JSON (collapsible) */}
      {showRaw && (
        <pre className="font-mono text-[10px] bg-muted p-2 rounded overflow-x-auto text-muted-foreground leading-relaxed border border-border/30">
          {formatJSON(sorted)}
        </pre>
      )}

      {/* Helpful hint */}
      <div className="text-[10px] text-muted-foreground/70 italic px-1">
        Longer bars indicate more recent causality
      </div>
    </div>
  );
}
