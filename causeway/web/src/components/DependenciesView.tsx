import { useState, useMemo } from 'react';
import { type DependenciesData } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Badge } from './ui/badge';
import { Input } from './ui/input';
import { Button } from './ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from './ui/select';
import { cn } from '@/lib/utils';
import { getServiceColor } from '@/lib/event-colors';
import { ServiceGraph } from './ServiceGraph';
import { Search, X, Filter } from 'lucide-react';

interface DependenciesViewProps {
  data: DependenciesData | null;
}

export function DependenciesView({ data }: DependenciesViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [serviceFilter, setServiceFilter] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  // Extract all unique service names
  const allServiceNames = useMemo(() => {
    if (!data) return [];
    const names = new Set<string>();
    data.services.forEach(s => names.add(s.name));
    return Array.from(names).sort();
  }, [data]);

  // Filter services and dependencies based on search and filter
  const filteredServices = useMemo(() => {
    if (!data) return [];
    let result = [...data.services];

    // Search query filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(service =>
        service.name.toLowerCase().includes(query)
      );
    }

    // Service filter
    if (serviceFilter !== 'all') {
      result = result.filter(s => s.name === serviceFilter);
    }

    return result.sort((a, b) => b.event_count - a.event_count);
  }, [data, searchQuery, serviceFilter]);

  const filteredDependencies = useMemo(() => {
    if (!data) return [];
    let result = data.dependencies;

    // Search query filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(dep =>
        dep.from.toLowerCase().includes(query) ||
        dep.to.toLowerCase().includes(query)
      );
    }

    // Service filter - show dependencies involving the selected service
    if (serviceFilter !== 'all') {
      result = result.filter(dep =>
        dep.from === serviceFilter || dep.to === serviceFilter
      );
    }

    return result;
  }, [data, searchQuery, serviceFilter]);

  const hasActiveFilters = searchQuery.trim() !== '' || serviceFilter !== 'all';
  const activeFilterCount = (searchQuery.trim() ? 1 : 0) + (serviceFilter !== 'all' ? 1 : 0);

  const clearFilters = () => {
    setSearchQuery('');
    setServiceFilter('all');
  };

  if (!data || data.services.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center space-y-2">
        <h3 className="text-lg font-semibold">No Service Dependencies</h3>
        <p className="text-sm text-muted-foreground">
          This trace doesn't contain any service dependency information
        </p>
      </div>
    );
  }

  return (
    <div className="h-[calc(100dvh-5.5rem)] overflow-y-auto p-3">
      <div className="space-y-4">
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-sm font-medium">Service Dependencies</CardTitle>
        </CardHeader>
        <CardContent className="pb-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-0.5">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Total Services</div>
              <div className="text-sm font-medium font-mono">{data.services.length}</div>
            </div>
            <div className="space-y-0.5">
              <div className="text-[10px] text-muted-foreground uppercase tracking-wide">Cross-Service Calls</div>
              <div className="text-sm font-medium font-mono">{data.dependencies.length}</div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Search and Filter */}
      <div className="space-y-2">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              type="text"
              placeholder="Search services and dependencies..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9 h-9 text-xs"
            />
            {searchQuery && (
              <button
                onClick={() => setSearchQuery('')}
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
              onClick={clearFilters}
            >
              Clear All
            </Button>
          )}
        </div>

        {/* Filter Dropdown */}
        {showFilters && (
          <Card className="bg-muted/30">
            <CardContent className="p-3">
              <div className="space-y-1">
                <label className="text-[10px] text-muted-foreground uppercase tracking-wide">
                  Service
                </label>
                <Select
                  value={serviceFilter}
                  onValueChange={setServiceFilter}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All Services</SelectItem>
                    {allServiceNames.map(name => (
                      <SelectItem key={name} value={name}>
                        {name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Results Summary */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground">
          <span>
            Showing {filteredServices.length} services, {filteredDependencies.length} dependencies
            {hasActiveFilters && ' (filtered)'}
          </span>
        </div>
      </div>

      {data.dependencies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Service Graph</CardTitle>
          </CardHeader>
          <CardContent>
            <ServiceGraph data={data} />
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium">Services</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-1.5">
            {filteredServices.map((service) => (
              <div
                key={service.name}
                className="flex items-center gap-3 p-2.5 rounded-md bg-muted/30 hover:bg-muted/50 transition-colors"
              >
                <span className="text-sm opacity-70">🔹</span>
                <span className={cn("flex-1 font-mono text-xs", getServiceColor(service.name))}>
                  {service.name}
                </span>
                <Badge variant="secondary" className="font-mono text-[10px]">
                  {service.event_count} events
                </Badge>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {data.dependencies.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-sm font-medium">Call Details</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-1.5">
              {filteredDependencies.map((dep, idx) => (
                <div
                  key={idx}
                  className="flex items-center gap-3 p-2.5 rounded-md bg-muted/30"
                >
                  <span className={cn("font-mono text-xs", getServiceColor(dep.from))}>
                    {dep.from}
                  </span>
                  <div className="flex items-center gap-1">
                    <div className="h-px w-6 bg-border"></div>
                    <Badge variant="outline" className="font-mono text-[10px] text-cyan-400 border-cyan-500/30">
                      {dep.call_count}
                    </Badge>
                    <div className="h-px w-6 bg-border"></div>
                    <span className="text-green-400 text-sm">→</span>
                  </div>
                  <span className={cn("font-mono text-xs", getServiceColor(dep.to))}>
                    {dep.to}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
      </div>
    </div>
  );
}
