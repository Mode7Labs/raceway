import { useState } from 'react';
import { type Event } from '../types';
import { EventsView } from './EventsView';
import { TreeView } from './TreeView';
import { TimelineView } from './TimelineView';
import { DashboardStats } from './DashboardStats';
import { SearchFilter } from './SearchFilter';
import { type CriticalPathData, type AnomaliesData } from '../types';
import { Button } from './ui/button';
import { List, GitBranch, Activity } from 'lucide-react';

type EventViewType = 'list' | 'tree' | 'timeline';

interface EventsTabWithSwitcherProps {
  events: Event[];
  selectedEventId: string | null;
  onEventSelect: (eventId: string) => void;
  criticalPathData: CriticalPathData | null;
  anomaliesData: AnomaliesData | null;
  raceCount: number;
}

export function EventsTabWithSwitcher({
  events,
  selectedEventId,
  onEventSelect,
  criticalPathData,
  anomaliesData,
  raceCount,
}: EventsTabWithSwitcherProps) {
  const [viewType, setViewType] = useState<EventViewType>('list');
  const [filteredEvents, setFilteredEvents] = useState<Event[]>(events);

  return (
    <div className="h-[calc(100dvh-5.5rem)] flex flex-col">
      {/* Fixed Header - DashboardStats + Search + Switcher */}
      <div className="flex-shrink-0 p-3 space-y-3">
        <DashboardStats
          events={events}
          criticalPathData={criticalPathData}
          anomaliesData={anomaliesData}
          raceCount={raceCount}
        />

        {/* Search and Filter */}
        <SearchFilter
          events={events}
          onFilteredEventsChange={setFilteredEvents}
        />

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
        </div>
      </div>

      {/* Scrollable Content Area */}
      <div className="flex-1 min-h-0 overflow-y-auto px-3 pb-3">
        {viewType === 'list' && (
          <EventsView
            events={filteredEvents}
            selectedEventId={selectedEventId}
            onEventSelect={onEventSelect}
          />
        )}
        {viewType === 'tree' && (
          <TreeView
            events={filteredEvents}
            selectedEventId={selectedEventId}
            onEventSelect={onEventSelect}
          />
        )}
        {viewType === 'timeline' && (
          <TimelineView
            events={filteredEvents}
            selectedEventId={selectedEventId}
            onEventSelect={onEventSelect}
          />
        )}
      </div>
    </div>
  );
}
