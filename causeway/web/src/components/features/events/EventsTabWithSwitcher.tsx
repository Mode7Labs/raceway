import { useState } from 'react';
import { type Event } from '@/types';
import { EventsView } from './EventsView';
import { TreeView } from './TreeView';
import { TimelineView } from './TimelineView';
import { TraceDAGView } from './TraceDAGView';
import { LockContentionView } from '@/components/views/analysis/LockContentionView';
import { type CriticalPathData, type AnomaliesData } from '@/types';
import { Button } from '@/components/ui/button';
import { List, GitBranch, Activity, Network, Lock } from 'lucide-react';

type EventViewType = 'list' | 'tree' | 'timeline' | 'graph' | 'locks';

interface EventsTabWithSwitcherProps {
  events: Event[];
  selectedEventId: string | null;
  onEventSelect: (eventId: string) => void;
  criticalPathData: CriticalPathData | null;
  anomaliesData: AnomaliesData | null;
  raceCount: number;
  onNavigateToService?: (serviceName: string) => void;
}

export function EventsTabWithSwitcher({
  events,
  selectedEventId,
  onEventSelect,
  onNavigateToService,
}: EventsTabWithSwitcherProps) {
  const [viewType, setViewType] = useState<EventViewType>('list');

  return (
    <div className="h-[calc(100dvh-5.5rem)] flex flex-col">
      {/* Fixed Header - View Switcher */}
      <div className="flex-shrink-0 p-3 space-y-3">
        {/* View Switcher */}
        <div className="flex items-center gap-2 border-b border-border pb-2">
          <span className="text-xs text-muted-foreground mr-2">View:</span>
          <Button
            variant={viewType === 'list' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => setViewType('list')}
          >
            <List className="w-3.5 h-3.5" />
            List
          </Button>
          <Button
            variant={viewType === 'tree' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => setViewType('tree')}
          >
            <GitBranch className="w-3.5 h-3.5" />
            Tree
          </Button>
          <Button
            variant={viewType === 'timeline' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => setViewType('timeline')}
          >
            <Activity className="w-3.5 h-3.5" />
            Timeline
          </Button>
          <Button
            variant={viewType === 'graph' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => setViewType('graph')}
          >
            <Network className="w-3.5 h-3.5" />
            Causal Graph
          </Button>
          <Button
            variant={viewType === 'locks' ? 'default' : 'ghost'}
            size="sm"
            className="h-7 text-xs gap-1.5"
            onClick={() => setViewType('locks')}
          >
            <Lock className="w-3.5 h-3.5" />
            Locks
          </Button>
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        {viewType === 'list' && (
          <EventsView
            events={events}
            selectedEventId={selectedEventId}
            onEventSelect={onEventSelect}
            onNavigateToService={onNavigateToService}
          />
        )}
        {viewType === 'tree' && (
          <TreeView
            events={events}
            selectedEventId={selectedEventId}
            onEventSelect={onEventSelect}
          />
        )}
        {viewType === 'timeline' && (
          <TimelineView
            events={events}
            selectedEventId={selectedEventId}
            onEventSelect={onEventSelect}
          />
        )}
        {viewType === 'graph' && (
          <div className="h-[600px]">
            <TraceDAGView
              events={events}
              selectedEventId={selectedEventId}
              onEventSelect={onEventSelect}
            />
          </div>
        )}
        {viewType === 'locks' && (
          <LockContentionView
            events={events}
            selectedEventId={selectedEventId}
            onEventSelect={onEventSelect}
          />
        )}
      </div>
    </div>
  );
}
