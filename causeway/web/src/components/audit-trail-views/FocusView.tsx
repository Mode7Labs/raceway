import { type AuditTrailData } from '../../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';
import { getThreadIdColor, getServiceColor } from '@/lib/event-colors';

interface FocusViewProps {
  data: AuditTrailData;
  currentStep: number;
  isPlaying: boolean;
  onStepChange: (step: number) => void;
  onPlayPause: () => void;
}

export function FocusView({ data, currentStep, isPlaying, onStepChange, onPlayPause }: FocusViewProps) {
  const formatTimestamp = (timestamp: string) => {
    try {
      const date = new Date(timestamp);
      return date.toLocaleTimeString('en-US', {
        hour12: false,
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
      }) + '.' + date.getMilliseconds().toString().padStart(3, '0');
    } catch {
      return timestamp;
    }
  };

  // Show current step plus 2 before and 2 after for context
  const contextSize = 2;
  const startIdx = Math.max(0, currentStep - contextSize);
  const endIdx = Math.min(data.accesses.length - 1, currentStep + contextSize);
  const visibleAccesses = data.accesses.slice(startIdx, endIdx + 1);

  const currentAccess = data.accesses[currentStep];

  return (
    <div className="space-y-4">
      {/* Current State Card - Prominent */}
      <Card className="border-primary/50">
        <CardHeader className="pb-3">
          <CardTitle className="text-xs flex items-center justify-between">
            <span>Current State at Step {currentStep + 1}</span>
            <Badge variant="default" className="text-[10px]">
              {formatTimestamp(currentAccess.timestamp)}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Variable</span>
              <span className="font-mono font-semibold text-xs">{data.variable}</span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Value Change</span>
              <div className="flex items-center gap-2 font-mono text-xs">
                {currentAccess.old_value !== null && (
                  <>
                    <span className="text-muted-foreground">{JSON.stringify(currentAccess.old_value)}</span>
                    <span className="text-primary">→</span>
                  </>
                )}
                <span className={cn(
                  "font-semibold",
                  currentAccess.access_type.includes('Read') ? 'text-blue-400' : 'text-orange-400'
                )}>
                  {JSON.stringify(currentAccess.new_value)}
                </span>
              </div>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Thread</span>
              <span className={cn("font-mono text-xs", getThreadIdColor(currentAccess.thread_id))}>
                {currentAccess.thread_id}
              </span>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Operation</span>
              <Badge className={cn(
                "text-[10px]",
                currentAccess.access_type.includes('Read')
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                  : 'bg-orange-500/20 text-orange-300 border-orange-500/30'
              )}>
                {currentAccess.access_type}
              </Badge>
            </div>

            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">Location</span>
              <span className="font-mono text-xs text-muted-foreground truncate max-w-xs" title={currentAccess.location}>
                {currentAccess.location}
              </span>
            </div>
          </div>

          {currentAccess.is_race && (
            <div className="mt-3 p-2 rounded bg-destructive/20 border border-destructive/50">
              <div className="text-xs font-semibold text-destructive mb-0.5">⚠️ Race Condition</div>
              <div className="text-[10px] text-muted-foreground">Concurrent modification from different thread</div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Timeline Context */}
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">Timeline Context</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {startIdx > 0 && (
            <div className="text-center text-xs text-muted-foreground py-2 border-b border-border">
              ... {startIdx} earlier {startIdx === 1 ? 'access' : 'accesses'} ...
            </div>
          )}

          {visibleAccesses.map((access, idx) => {
            const actualIdx = startIdx + idx;
            const isCurrent = actualIdx === currentStep;
            return (
              <div
                key={actualIdx}
                onClick={() => onStepChange(actualIdx)}
                className={cn(
                  "p-2 rounded-md border transition-all cursor-pointer hover:bg-accent/50",
                  isCurrent
                    ? 'border-primary bg-primary/10'
                    : 'border-border',
                  access.is_race && 'border-l-4 border-l-destructive'
                )}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {access.is_race && <span className="text-xs">⚠️</span>}
                    <Badge className={cn(
                      "text-[10px]",
                      access.access_type.includes('Read')
                        ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                        : 'bg-orange-500/20 text-orange-300 border-orange-500/30'
                    )}>
                      {access.access_type}
                    </Badge>
                    <span className={cn("font-mono text-xs", getThreadIdColor(access.thread_id))}>
                      {access.thread_id}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isCurrent && <Badge variant="default" className="text-[9px]">Current</Badge>}
                    <span className="text-[10px] text-muted-foreground">#{actualIdx + 1}</span>
                  </div>
                </div>
              </div>
            );
          })}

          {endIdx < data.accesses.length - 1 && (
            <div className="text-center text-xs text-muted-foreground py-2 border-t border-border">
              ... {data.accesses.length - 1 - endIdx} later {data.accesses.length - 1 - endIdx === 1 ? 'access' : 'accesses'} ...
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
