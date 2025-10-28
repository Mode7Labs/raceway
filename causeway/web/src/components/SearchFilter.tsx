import { useState, useMemo, useEffect } from 'react';
import { type Event } from '../types';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Badge } from './ui/badge';
import { Card, CardContent } from './ui/card';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from './ui/select';
import { Search, X, Filter } from 'lucide-react';

export interface FilterState {
  searchQuery: string;
  threadId: string;
  serviceName: string;
  eventKind: string;
  environment: string;
}

interface SearchFilterProps {
  events: Event[];
  onFilteredEventsChange: (filteredEvents: Event[]) => void;
}

export function SearchFilter({ events, onFilteredEventsChange }: SearchFilterProps) {
  const [filters, setFilters] = useState<FilterState>({
    searchQuery: '',
    threadId: 'all',
    serviceName: 'all',
    eventKind: 'all',
    environment: 'all',
  });

  const [showFilters, setShowFilters] = useState(false);

  // Extract unique values for dropdowns
  const uniqueThreadIds = useMemo(() => {
    const threads = new Set(events.map(e => e.metadata.thread_id));
    return Array.from(threads).sort();
  }, [events]);

  const uniqueServices = useMemo(() => {
    const services = new Set(events.map(e => e.metadata.service_name));
    return Array.from(services).sort();
  }, [events]);

  const uniqueEventKinds = useMemo(() => {
    const kinds = new Set(events.map(e => {
      if (typeof e.kind === 'string') return e.kind;
      return Object.keys(e.kind)[0] || 'Unknown';
    }));
    return Array.from(kinds).sort();
  }, [events]);

  const uniqueEnvironments = useMemo(() => {
    const envs = new Set(events.map(e => e.metadata.environment));
    return Array.from(envs).sort();
  }, [events]);

  // Filter events based on current filters
  const filteredEvents = useMemo(() => {
    let result = events;

    // Search query filter (searches across multiple fields)
    if (filters.searchQuery.trim()) {
      const query = filters.searchQuery.toLowerCase();
      result = result.filter(event => {
        const kind = typeof event.kind === 'string'
          ? event.kind
          : JSON.stringify(event.kind);
        const tags = JSON.stringify(event.metadata.tags);

        return (
          event.id.toLowerCase().includes(query) ||
          kind.toLowerCase().includes(query) ||
          event.metadata.thread_id.toLowerCase().includes(query) ||
          event.metadata.service_name.toLowerCase().includes(query) ||
          event.metadata.environment.toLowerCase().includes(query) ||
          tags.toLowerCase().includes(query)
        );
      });
    }

    // Thread filter
    if (filters.threadId !== 'all') {
      result = result.filter(e => e.metadata.thread_id === filters.threadId);
    }

    // Service filter
    if (filters.serviceName !== 'all') {
      result = result.filter(e => e.metadata.service_name === filters.serviceName);
    }

    // Event kind filter
    if (filters.eventKind !== 'all') {
      result = result.filter(e => {
        const kind = typeof e.kind === 'string' ? e.kind : Object.keys(e.kind)[0];
        return kind === filters.eventKind;
      });
    }

    // Environment filter
    if (filters.environment !== 'all') {
      result = result.filter(e => e.metadata.environment === filters.environment);
    }

    return result;
  }, [events, filters]);

  // Update parent component when filtered events change
  useEffect(() => {
    onFilteredEventsChange(filteredEvents);
  }, [filteredEvents, onFilteredEventsChange]);

  const handleSearchChange = (value: string) => {
    setFilters(prev => ({ ...prev, searchQuery: value }));
  };

  const handleFilterChange = (key: keyof FilterState, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearAllFilters = () => {
    setFilters({
      searchQuery: '',
      threadId: 'all',
      serviceName: 'all',
      eventKind: 'all',
      environment: 'all',
    });
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (filters.searchQuery.trim()) count++;
    if (filters.threadId !== 'all') count++;
    if (filters.serviceName !== 'all') count++;
    if (filters.eventKind !== 'all') count++;
    if (filters.environment !== 'all') count++;
    return count;
  }, [filters]);

  const hasActiveFilters = activeFilterCount > 0;

  return (
    <div className="space-y-2">
      {/* Search Bar */}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            type="text"
            placeholder="Search events (ID, kind, thread, service, tags...)"
            value={filters.searchQuery}
            onChange={(e) => handleSearchChange(e.target.value)}
            className="pl-9 h-9 text-xs"
          />
          {filters.searchQuery && (
            <button
              onClick={() => handleSearchChange('')}
              className="absolute right-2.5 top-2.5 text-muted-foreground hover:text-foreground"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <Button
          variant={showFilters ? 'default' : 'outline'}
          size="sm"
          className="h-9 gap-1.5"
          onClick={() => setShowFilters(!showFilters)}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
          {activeFilterCount > 0 && (
            <Badge variant="secondary" className="ml-1 h-4 px-1 text-[10px]">
              {activeFilterCount}
            </Badge>
          )}
        </Button>
        {hasActiveFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-9 text-xs"
            onClick={clearAllFilters}
          >
            Clear All
          </Button>
        )}
      </div>

      {/* Filter Dropdowns (collapsible) */}
      {showFilters && (
        <Card className="bg-muted/30">
          <CardContent className="p-3">
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {/* Thread Filter */}
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Thread
                </label>
                <Select
                  value={filters.threadId}
                  onValueChange={(value) => handleFilterChange('threadId', value)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Threads</SelectItem>
                    {uniqueThreadIds.map(thread => (
                      <SelectItem key={thread} value={thread}>
                        {thread}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Service Filter */}
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Service
                </label>
                <Select
                  value={filters.serviceName}
                  onValueChange={(value) => handleFilterChange('serviceName', value)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Services</SelectItem>
                    {uniqueServices.map(service => (
                      <SelectItem key={service} value={service}>
                        {service}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Event Kind Filter */}
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Event Type
                </label>
                <Select
                  value={filters.eventKind}
                  onValueChange={(value) => handleFilterChange('eventKind', value)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Types</SelectItem>
                    {uniqueEventKinds.map(kind => (
                      <SelectItem key={kind} value={kind}>
                        {kind}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Environment Filter */}
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Environment
                </label>
                <Select
                  value={filters.environment}
                  onValueChange={(value) => handleFilterChange('environment', value)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Environments</SelectItem>
                    {uniqueEnvironments.map(env => (
                      <SelectItem key={env} value={env}>
                        {env}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Results Summary */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>
          Showing {filteredEvents.length} of {events.length} events
          {hasActiveFilters && ' (filtered)'}
        </span>
      </div>
    </div>
  );
}
