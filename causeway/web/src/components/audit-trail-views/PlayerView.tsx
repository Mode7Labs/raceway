import { type AuditTrailData } from '../../types';
import { Card, CardContent } from '../ui/card';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';
import { getThreadIdColor } from '@/lib/event-colors';
import { TimelineScrubber } from '../TimelineScrubber';

interface PlayerViewProps {
  data: AuditTrailData;
  currentStep: number;
  isPlaying: boolean;
  onStepChange: (step: number) => void;
  onPlayPause: () => void;
}

export function PlayerView({ data, currentStep, isPlaying, onStepChange, onPlayPause }: PlayerViewProps) {
  const currentAccess = data.accesses[currentStep];

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

  return (
    <div className="flex flex-col h-full space-y-4">
      {/* Main Display Area - Like a video frame */}
      <Card className="flex-1 flex items-center justify-center min-h-[400px] bg-gradient-to-br from-background to-muted/20">
        <CardContent className="w-full max-w-2xl p-8">
          <div className="space-y-6 text-center">
            {/* Variable Name */}
            <div className="space-y-2">
              <div className="text-sm text-muted-foreground">Variable</div>
              <div className="font-mono text-2xl font-bold">{data.variable}</div>
            </div>

            {/* Value Change - The Star of the Show */}
            <div className="flex items-center justify-center gap-6 py-8">
              {currentAccess.old_value !== null && (
                <>
                  <div className="text-center">
                    <div className="text-xs text-muted-foreground mb-2">Previous</div>
                    <div className="font-mono text-3xl text-muted-foreground">
                      {JSON.stringify(currentAccess.old_value)}
                    </div>
                  </div>
                  <div className="text-4xl text-primary animate-pulse">→</div>
                </>
              )}
              <div className="text-center">
                <div className="text-xs text-muted-foreground mb-2">
                  {currentAccess.old_value !== null ? 'Current' : 'Value'}
                </div>
                <div className={cn(
                  "font-mono text-4xl font-bold",
                  currentAccess.access_type.includes('Read') ? 'text-blue-400' : 'text-orange-400'
                )}>
                  {JSON.stringify(currentAccess.new_value)}
                </div>
              </div>
            </div>

            {/* Operation Details */}
            <div className="flex items-center justify-center gap-4 flex-wrap">
              <Badge className={cn(
                "text-sm px-3 py-1",
                currentAccess.access_type.includes('Read')
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                  : 'bg-orange-500/20 text-orange-300 border-orange-500/30'
              )}>
                {currentAccess.access_type}
              </Badge>
              <div className={cn("font-mono text-sm", getThreadIdColor(currentAccess.thread_id))}>
                {currentAccess.thread_id}
              </div>
              <div className="text-sm text-muted-foreground">
                {formatTimestamp(currentAccess.timestamp)}
              </div>
            </div>

            {/* Location */}
            <div className="text-xs font-mono text-muted-foreground">
              {currentAccess.location}
            </div>

            {/* Race Warning - Prominent */}
            {currentAccess.is_race && (
              <div className="mt-4 p-4 rounded-lg bg-destructive/20 border-2 border-destructive/50 animate-pulse">
                <div className="text-lg font-semibold text-destructive mb-1">
                  ⚠️ RACE CONDITION DETECTED
                </div>
                <div className="text-sm text-muted-foreground">
                  Concurrent modification from different thread
                </div>
              </div>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Timeline Scrubber - At Bottom Like Video Player */}
      <div className="border-t border-border pt-4">
        <TimelineScrubber
          totalSteps={data.accesses.length}
          currentStep={currentStep}
          onStepChange={onStepChange}
          stepLabels={data.accesses.map(a => a.access_type)}
          isPlaying={isPlaying}
          onPlayPause={onPlayPause}
          playbackSpeed={2}
        />
      </div>
    </div>
  );
}
