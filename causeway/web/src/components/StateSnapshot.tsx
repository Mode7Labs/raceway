import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { cn } from '@/lib/utils';
import { getThreadIdColor } from '@/lib/event-colors';

export interface VariableState {
  name: string;
  value: any;
  lastModifiedBy: string; // thread_id
  lastModifiedAt: string; // timestamp
  isChanged: boolean; // Whether it changed in this step
  accessType?: string; // 'Read' | 'Write' | etc.
}

interface StateSnapshotProps {
  variables: VariableState[];
  timestamp: string;
  stepNumber: number;
  highlightChanged?: boolean;
}

export function StateSnapshot({ variables, timestamp, stepNumber, highlightChanged = true }: StateSnapshotProps) {
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

  const changedVars = variables.filter(v => v.isChanged);
  const unchangedVars = variables.filter(v => !v.isChanged);

  if (variables.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm">State Snapshot</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-sm text-muted-foreground text-center py-8">
            No variables tracked yet
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm">State Snapshot</CardTitle>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="font-mono">{formatTimestamp(timestamp)}</span>
            <Badge variant="outline" className="text-[10px]">
              Step {stepNumber + 1}
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Changed Variables (if highlighting) */}
        {highlightChanged && changedVars.length > 0 && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-orange-400 flex items-center gap-2">
              <span>Recently Modified</span>
              <Badge variant="outline" className="text-[9px] bg-orange-500/10 text-orange-400 border-orange-500/30">
                {changedVars.length}
              </Badge>
            </div>
            <div className="space-y-1.5">
              {changedVars.map((variable) => (
                <div
                  key={variable.name}
                  className={cn(
                    "p-2 rounded-md border transition-all",
                    "border-orange-500/50 bg-orange-500/10"
                  )}
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-mono text-xs font-semibold truncate" title={variable.name}>
                      {variable.name}
                    </span>
                    {variable.accessType && (
                      <Badge className={cn(
                        "text-[9px]",
                        variable.accessType.includes('Read')
                          ? 'bg-blue-500/20 text-blue-300 border-blue-500/30'
                          : 'bg-orange-500/20 text-orange-300 border-orange-500/30'
                      )}>
                        {variable.accessType}
                      </Badge>
                    )}
                  </div>
                  <div className="font-mono text-xs bg-muted/50 p-1.5 rounded mb-1 break-all">
                    {JSON.stringify(variable.value)}
                  </div>
                  <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                    <span className={cn("font-mono", getThreadIdColor(variable.lastModifiedBy))}>
                      {variable.lastModifiedBy}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Unchanged Variables */}
        {unchangedVars.length > 0 && (
          <div className="space-y-2">
            {highlightChanged && changedVars.length > 0 && (
              <div className="text-xs font-medium text-muted-foreground">
                Other Variables
              </div>
            )}
            <div className="space-y-1.5">
              {unchangedVars.map((variable) => (
                <div
                  key={variable.name}
                  className="p-2 rounded-md border border-border bg-card/50"
                >
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <span className="font-mono text-xs truncate" title={variable.name}>
                      {variable.name}
                    </span>
                  </div>
                  <div className="font-mono text-xs text-muted-foreground bg-muted/30 p-1.5 rounded break-all">
                    {JSON.stringify(variable.value)}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Summary Stats */}
        <div className="pt-2 border-t border-border">
          <div className="flex items-center gap-4 text-[10px] text-muted-foreground">
            <span>Total: {variables.length} variables</span>
            {highlightChanged && changedVars.length > 0 && (
              <span className="text-orange-400">{changedVars.length} modified</span>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
