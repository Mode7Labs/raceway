import { type AuditTrailData } from '@/types';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import { getThreadIdColor } from '@/lib/event-colors';
import { config } from '@/config';

interface DebuggerViewProps {
  data: AuditTrailData;
  currentStep: number;
  isPlaying: boolean;
  onStepChange: (step: number) => void;
  onPlayPause: () => void;
  apiBaseUrl?: string;
  onTraceSelect?: (traceId: string) => void;
}

export function DebuggerView({ data, currentStep, isPlaying, onStepChange, onPlayPause, apiBaseUrl = config.apiBaseUrl, onTraceSelect }: DebuggerViewProps) {

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

  const currentAccess = data.accesses[currentStep];

  if (!currentAccess) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-2">
        <h3 className="text-lg font-semibold">No accesses available</h3>
        <p className="text-sm text-muted-foreground">
          The selected step is out of range for this variable.
        </p>
      </div>
    );
  }

  // Calculate derived values
  const delta = currentAccess.old_value !== null && typeof currentAccess.new_value === 'number' && typeof currentAccess.old_value === 'number'
    ? currentAccess.new_value - currentAccess.old_value
    : null;

  return (
    <div className="space-y-3 font-mono">
      {/* Variables Panel (like VS Code debugger) */}
      <div className="grid grid-cols-2 gap-3">
        {/* Local Variables */}
        <Card className="bg-muted/30">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-xs font-semibold flex items-center justify-between">
              <span>VARIABLES</span>
              <Badge variant="outline" className="text-[9px]">
                Step {currentStep + 1}/{data.accesses.length}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0 space-y-1 text-xs">
            <div className="flex items-start justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">▼ Local</span>
            </div>
            <div className="pl-4 space-y-0.5">
              <div className="flex items-start justify-between hover:bg-accent/30 px-1 rounded">
                <span className="text-primary">{data.variable}:</span>
                <span className={cn(
                  "font-semibold",
                  currentAccess.access_type.includes('Read') ? 'text-blue-400' : 'text-orange-400'
                )}>
                  {JSON.stringify(currentAccess.new_value)}
                </span>
              </div>
              {currentAccess.old_value !== null && (
                <div className="flex items-start justify-between hover:bg-accent/30 px-1 rounded">
                  <span className="text-muted-foreground">prev_value:</span>
                  <span className="text-muted-foreground">{JSON.stringify(currentAccess.old_value)}</span>
                </div>
              )}
              <div className="flex items-start justify-between hover:bg-accent/30 px-1 rounded">
                <span className="text-muted-foreground">thread_id:</span>
                <span className={getThreadIdColor(currentAccess.thread_id)}>{currentAccess.thread_id}</span>
              </div>
              <div className="flex items-start justify-between hover:bg-accent/30 px-1 rounded">
                <span className="text-muted-foreground">operation:</span>
                <span>{currentAccess.access_type}</span>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Watch Panel */}
        <Card className="bg-muted/30">
          <CardHeader className="pb-2 pt-3 px-3">
            <CardTitle className="text-xs font-semibold">WATCH</CardTitle>
          </CardHeader>
          <CardContent className="px-3 pb-3 pt-0 space-y-1 text-xs">
            <div className="flex items-start justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Expressions</span>
            </div>
            <div className="pl-4 space-y-0.5">
              <div className="flex items-start justify-between hover:bg-accent/30 px-1 rounded">
                <span className="text-primary">{data.variable}:</span>
                <span className="font-semibold">{JSON.stringify(currentAccess.new_value)}</span>
              </div>
              {delta !== null && (
                <div className="flex items-start justify-between hover:bg-accent/30 px-1 rounded">
                  <span className="text-primary">delta:</span>
                  <span className={cn(
                    "font-semibold",
                    delta > 0 ? 'text-green-400' : delta < 0 ? 'text-red-400' : 'text-muted-foreground'
                  )}>
                    {delta > 0 ? '+' : ''}{delta}
                  </span>
                </div>
              )}
              {currentAccess.old_value !== null && (
                <div className="flex items-start justify-between hover:bg-accent/30 px-1 rounded">
                  <span className="text-primary">prev_{data.variable}:</span>
                  <span className="text-muted-foreground">{JSON.stringify(currentAccess.old_value)}</span>
                </div>
              )}
              <div className="flex items-start justify-between hover:bg-accent/30 px-1 rounded">
                <span className="text-primary">is_race:</span>
                <span className={currentAccess.is_race ? 'text-destructive font-semibold' : 'text-muted-foreground'}>
                  {currentAccess.is_race ? 'true' : 'false'}
                </span>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Call Stack / Timeline */}
      <Card className="bg-muted/30">
        <CardHeader className="pb-2 pt-3 px-3">
          <CardTitle className="text-xs font-semibold">CALL STACK / TIMELINE</CardTitle>
        </CardHeader>
        <CardContent className="px-3 pb-3 pt-0 space-y-1 text-[11px]">
          {data.accesses.map((access, idx) => {
            const isCurrent = idx === currentStep;
            const isPast = idx < currentStep;
            const isRace = access.is_race;

            return (
              <div
                key={idx}
                onClick={() => onStepChange(idx)}
                className={cn(
                  "flex items-center gap-2 px-2 py-1 rounded cursor-pointer transition-all",
                  isCurrent && "bg-primary/20 border-l-2 border-l-primary",
                  !isCurrent && isPast && "opacity-60 hover:opacity-100 hover:bg-accent/30",
                  !isCurrent && !isPast && "opacity-30 hover:opacity-60 hover:bg-accent/20",
                  isRace && "border-l-2 border-l-destructive"
                )}
              >
                <span className="text-muted-foreground w-6">#{idx + 1}</span>
                <span className={cn(
                  access.access_type.includes('Read') ? 'text-blue-400' : 'text-orange-400'
                )}>
                  {access.access_type.toLowerCase()}
                </span>
                <span className="text-foreground">({data.variable}, {JSON.stringify(access.new_value)})</span>
                <span className="text-muted-foreground flex-1 truncate">{access.location}</span>
                {isCurrent && <Badge variant="default" className="text-[9px]">CURRENT</Badge>}
                {isRace && <span className="text-destructive text-xs">⚠️</span>}
              </div>
            );
          })}
        </CardContent>
      </Card>

      {/* Console Output / Details */}
      {currentAccess.is_race && (
        <Card className="bg-destructive/10 border-destructive/50">
          <CardContent className="p-3 text-xs">
            <div className="text-destructive font-semibold mb-1">⚠️ RACE CONDITION DETECTED</div>
            <div className="text-muted-foreground space-y-0.5">
              <div>Concurrent modification from different thread</div>
              <div>Location: {currentAccess.location}</div>
              <div>Thread: {currentAccess.thread_id}</div>
              <div>Time: {formatTimestamp(currentAccess.timestamp)}</div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
