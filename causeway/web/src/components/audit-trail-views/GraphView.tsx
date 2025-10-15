import { type AuditTrailData } from '../../types';
import { Card, CardContent, CardHeader, CardTitle } from '../ui/card';
import { Badge } from '../ui/badge';
import { cn } from '@/lib/utils';
import { getThreadIdColor } from '@/lib/event-colors';

interface GraphViewProps {
  data: AuditTrailData;
  currentStep: number;
  isPlaying: boolean;
  onStepChange: (step: number) => void;
  onPlayPause: () => void;
}

export function GraphView({ data, currentStep, isPlaying, onStepChange, onPlayPause }: GraphViewProps) {
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

  // Try to extract numeric values for graphing
  const numericValues = data.accesses.map(access => {
    const val = access.new_value;
    if (typeof val === 'number') return val;
    if (typeof val === 'string' && !isNaN(Number(val))) return Number(val);
    return null;
  });

  const hasNumericData = numericValues.some(v => v !== null);
  const minValue = hasNumericData ? Math.min(...numericValues.filter(v => v !== null) as number[]) : 0;
  const maxValue = hasNumericData ? Math.max(...numericValues.filter(v => v !== null) as number[]) : 100;
  const range = maxValue - minValue || 1;

  return (
    <div className="flex flex-col h-full">
      {/* Graph Area - No scroll, fully responsive */}
      <div className="flex-1 min-h-0 overflow-hidden mb-3">
        <Card className="flex flex-col h-full">
          <CardHeader className="pb-3 flex-shrink-0">
            <CardTitle className="text-sm">Value History</CardTitle>
          </CardHeader>
          <CardContent className="flex-1 min-h-0 flex items-center justify-center p-4 pb-6">
            {hasNumericData ? (
              <div className="w-full h-full relative flex flex-col">
                {/* Y-axis labels */}
                <div className="absolute left-0 top-0 bottom-8 w-12 flex flex-col justify-between text-[10px] text-muted-foreground font-mono pt-4 pb-2">
                  <span>{maxValue}</span>
                  <span>{(maxValue + minValue) / 2}</span>
                  <span>{minValue}</span>
                </div>

                {/* Graph area with padding for labels */}
                <div className="ml-12 mr-8 flex-1 border-l border-b border-border relative pt-4 pb-2">
                  {/* Grid lines */}
                  {[0, 25, 50, 75, 100].map(percent => (
                    <div
                      key={percent}
                      className="absolute left-0 right-0 border-t border-dashed border-muted"
                      style={{ top: `${percent}%` }}
                    />
                  ))}

                  {/* Data points and line */}
                  <svg className="absolute inset-0 w-full h-full" style={{ overflow: 'visible' }}>
                    {/* Draw line connecting points */}
                    {data.accesses.slice(0, currentStep + 1).map((access, idx) => {
                      if (idx === 0 || numericValues[idx] === null) return null;
                      const prevVal = numericValues[idx - 1];
                      if (prevVal === null) return null;

                      const x1 = ((idx - 1) / (data.accesses.length - 1)) * 100;
                      const y1 = 100 - (((prevVal - minValue) / range) * 100);
                      const x2 = (idx / (data.accesses.length - 1)) * 100;
                      const y2 = 100 - (((numericValues[idx]! - minValue) / range) * 100);

                      return (
                        <line
                          key={idx}
                          x1={`${x1}%`}
                          y1={`${y1}%`}
                          x2={`${x2}%`}
                          y2={`${y2}%`}
                          stroke="hsl(var(--primary))"
                          strokeWidth="2"
                          opacity={idx <= currentStep ? "1" : "0.2"}
                        />
                      );
                    })}

                    {/* Draw points */}
                    {data.accesses.map((access, idx) => {
                      const val = numericValues[idx];
                      if (val === null) return null;

                      const x = (idx / (data.accesses.length - 1)) * 100;
                      const y = 100 - (((val - minValue) / range) * 100);
                      const isCurrent = idx === currentStep;
                      const isPast = idx <= currentStep;

                      return (
                        <g key={idx}>
                          <circle
                            cx={`${x}%`}
                            cy={`${y}%`}
                            r={isCurrent ? "8" : "4"}
                            className={cn(
                              "cursor-pointer transition-all",
                              isCurrent && "animate-pulse",
                              access.is_race
                                ? "fill-destructive stroke-background"
                                : isCurrent
                                ? "fill-primary stroke-background"
                                : isPast
                                ? "fill-primary stroke-background"
                                : "fill-border stroke-foreground"
                            )}
                            strokeWidth="2"
                            onClick={() => onStepChange(idx)}
                          />
                          {isCurrent && (
                            <text
                              x={`${x}%`}
                              y={`${y}%`}
                              dy="-15"
                              textAnchor="middle"
                              className="text-[10px] font-mono fill-primary font-semibold"
                            >
                              YOU ARE HERE
                            </text>
                          )}
                        </g>
                      );
                    })}
                  </svg>
                </div>

                {/* X-axis labels (step numbers) */}
                <div className="ml-12 mr-8 mt-2 flex justify-between text-[10px] text-muted-foreground font-mono">
                  <span>Step 1</span>
                  <span>Step {data.accesses.length}</span>
                </div>
              </div>
            ) : (
              <div className="text-center space-y-2">
                <div className="text-4xl">📊</div>
                <div className="text-sm text-muted-foreground">
                  Graph visualization only available for numeric values
                </div>
                <div className="text-xs text-muted-foreground">
                  Current value type: {typeof currentAccess.new_value}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Bottom Details Bar - Fixed height */}
      <div className="bg-card/50 flex-shrink-0">
        <div className="px-4 py-2">
          <div className="flex items-center justify-between gap-3">
            {/* Left: Step info and value */}
            <div className="flex items-center gap-2 flex-wrap">
              <Badge variant="default" className="text-[10px] flex-shrink-0 h-5 font-mono font-normal">
                Step {currentStep + 1}/{data.accesses.length}
              </Badge>
              <div className="flex items-center gap-1.5 font-mono text-[10px]">
                <span className="text-muted-foreground">{data.variable}:</span>
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
              <Badge className={cn(
                "text-[9px] h-5",
                currentAccess.access_type.includes('Read')
                  ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                  : 'bg-orange-500/20 text-orange-300 border-orange-500/30'
              )}>
                {currentAccess.access_type}
              </Badge>
              <span className={cn("font-mono text-[10px]", getThreadIdColor(currentAccess.thread_id))}>
                {currentAccess.thread_id}
              </span>
              {currentAccess.is_race && (
                <Badge variant="destructive" className="text-[9px] h-5">⚠️ Race</Badge>
              )}
            </div>

            {/* Right: Location */}
            <div className="flex-1 min-w-0">
              <div className="text-[10px] text-muted-foreground font-mono truncate" title={currentAccess.location}>
                {currentAccess.location}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
