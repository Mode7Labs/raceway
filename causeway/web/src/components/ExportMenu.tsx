import { useState } from 'react';
import { type Event, type CriticalPathData, type AnomaliesData, type DependenciesData } from '../types';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Download, FileJson, FileText, FileSpreadsheet, Check } from 'lucide-react';
import { exportToJSON, exportToCSV, exportCriticalPathToMarkdown, exportAnomaliesToMarkdown } from '../lib/export';

interface ExportMenuProps {
  traceId: string;
  events: Event[];
  criticalPathData: CriticalPathData | null;
  anomaliesData: AnomaliesData | null;
  dependenciesData: DependenciesData | null;
  raceCount: number;
}

export function ExportMenu({
  traceId,
  events,
  criticalPathData,
  anomaliesData,
  dependenciesData,
  raceCount,
}: ExportMenuProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [exported, setExported] = useState<string | null>(null);

  const handleExport = (type: string, exportFn: () => void) => {
    exportFn();
    setExported(type);
    setTimeout(() => setExported(null), 2000);
  };

  return (
    <div className="relative">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 w-7 p-0"
        onClick={() => setShowMenu(!showMenu)}
        title="Export Data"
      >
        <Download className="h-4 w-4" />
      </Button>

      {showMenu && (
        <>
          <div
            className="fixed inset-0 z-10"
            onClick={() => setShowMenu(false)}
          />
          <Card className="absolute right-0 top-full mt-2 w-64 z-20 shadow-lg">
            <CardContent className="p-2">
              <div className="space-y-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 h-9"
                  onClick={() => handleExport('json', () => exportToJSON(traceId, events, criticalPathData, anomaliesData, dependenciesData, raceCount))}
                >
                  {exported === 'json' ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <FileJson className="h-4 w-4" />
                  )}
                  <div className="flex-1 text-left">
                    <div className="text-xs font-medium">Full Trace (JSON)</div>
                    <div className="text-[10px] text-muted-foreground">Complete trace data</div>
                  </div>
                </Button>

                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start gap-2 h-9"
                  onClick={() => handleExport('csv', () => exportToCSV(events))}
                >
                  {exported === 'csv' ? (
                    <Check className="h-4 w-4 text-green-400" />
                  ) : (
                    <FileSpreadsheet className="h-4 w-4" />
                  )}
                  <div className="flex-1 text-left">
                    <div className="text-xs font-medium">Events (CSV)</div>
                    <div className="text-[10px] text-muted-foreground">Event list for analysis</div>
                  </div>
                </Button>

                {criticalPathData && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2 h-9"
                    onClick={() => handleExport('critical-path', () => exportCriticalPathToMarkdown(criticalPathData, traceId))}
                  >
                    {exported === 'critical-path' ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                    <div className="flex-1 text-left">
                      <div className="text-xs font-medium">Critical Path (MD)</div>
                      <div className="text-[10px] text-muted-foreground">Markdown report</div>
                    </div>
                  </Button>
                )}

                {anomaliesData && anomaliesData.anomaly_count > 0 && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="w-full justify-start gap-2 h-9"
                    onClick={() => handleExport('anomalies', () => exportAnomaliesToMarkdown(anomaliesData, traceId))}
                  >
                    {exported === 'anomalies' ? (
                      <Check className="h-4 w-4 text-green-400" />
                    ) : (
                      <FileText className="h-4 w-4" />
                    )}
                    <div className="flex-1 text-left">
                      <div className="text-xs font-medium">Anomalies (MD)</div>
                      <div className="text-[10px] text-muted-foreground">Performance report</div>
                    </div>
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
