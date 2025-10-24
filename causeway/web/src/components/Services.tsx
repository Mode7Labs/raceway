import { useState, useEffect } from 'react';
import { RacewayAPI } from '../api';
import { type ServiceListItem, type ServiceDependenciesData } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Input } from './ui/input';
import { Loader2, Search, ArrowRight, Users } from 'lucide-react';
import { cn } from '@/lib/utils';
import { getServiceColor } from '@/lib/event-colors';

export function Services() {
  const [services, setServices] = useState<ServiceListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedService, setSelectedService] = useState<string | null>(null);
  const [dependencies, setDependencies] = useState<ServiceDependenciesData | null>(null);
  const [loadingDeps, setLoadingDeps] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  // Fetch all services on mount
  useEffect(() => {
    const fetchServices = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await RacewayAPI.getServices();
        if (response.data) {
          setServices(response.data.services);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch services');
        console.error('Error fetching services:', err);
      } finally {
        setLoading(false);
      }
    };
    fetchServices();
  }, []);

  // Fetch dependencies when a service is selected
  useEffect(() => {
    if (!selectedService) {
      setDependencies(null);
      return;
    }

    const fetchDependencies = async () => {
      setLoadingDeps(true);
      try {
        const response = await RacewayAPI.getServiceDependencies(selectedService);
        if (response.data) {
          setDependencies(response.data);
        }
      } catch (err) {
        console.error('Error fetching dependencies:', err);
      } finally {
        setLoadingDeps(false);
      }
    };
    fetchDependencies();
  }, [selectedService]);

  // Filter services based on search query
  const filteredServices = services.filter(service =>
    service.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle className="text-destructive">Error</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">{error}</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col md:flex-row gap-4 p-6">
      {/* Left panel - Services list */}
      <div className="flex-1 flex flex-col space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-bold">Services</h2>
            <p className="text-sm text-muted-foreground">
              {services.length} services across all traces
            </p>
          </div>
        </div>

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search services..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {/* Services list */}
        <div className="flex-1 overflow-auto space-y-2">
          {filteredServices.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                No services found
              </CardContent>
            </Card>
          ) : (
            filteredServices.map((service) => (
              <Card
                key={service.name}
                className={cn(
                  "cursor-pointer transition-colors hover:bg-accent",
                  selectedService === service.name && "bg-accent border-primary"
                )}
                onClick={() => setSelectedService(service.name)}
              >
                <CardHeader className="py-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: getServiceColor(service.name) }}
                      />
                      <CardTitle className="text-base font-medium">
                        {service.name}
                      </CardTitle>
                    </div>
                    {selectedService === service.name && (
                      <ArrowRight className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                </CardHeader>
                <CardContent className="py-2 pt-0">
                  <div className="flex items-center gap-4 text-sm text-muted-foreground">
                    <div>
                      <span className="font-medium text-foreground">
                        {service.event_count.toLocaleString()}
                      </span>
                      {' '}events
                    </div>
                    <div>
                      <span className="font-medium text-foreground">
                        {service.trace_count.toLocaleString()}
                      </span>
                      {' '}traces
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))
          )}
        </div>
      </div>

      {/* Right panel - Service dependencies */}
      {selectedService && (
        <div className="flex-1 flex flex-col space-y-4">
          <div>
            <h3 className="text-xl font-semibold">Dependencies</h3>
            <p className="text-sm text-muted-foreground">
              {selectedService}
            </p>
          </div>

          {loadingDeps ? (
            <div className="flex-1 flex items-center justify-center">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : dependencies ? (
            <div className="flex-1 overflow-auto space-y-4">
              {/* Calls To */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <ArrowRight className="h-4 w-4" />
                    Calls To ({dependencies.calls_to.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {dependencies.calls_to.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No downstream dependencies</p>
                  ) : (
                    <div className="space-y-2">
                      {dependencies.calls_to.map((dep) => (
                        <div
                          key={dep.to}
                          className="flex items-center justify-between p-2 rounded border"
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: getServiceColor(dep.to) }}
                            />
                            <span className="font-medium">{dep.to}</span>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <div>
                              <span className="font-medium text-foreground">
                                {dep.total_calls.toLocaleString()}
                              </span>
                              {' '}calls
                            </div>
                            <div>
                              <span className="font-medium text-foreground">
                                {dep.trace_count.toLocaleString()}
                              </span>
                              {' '}traces
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Called By */}
              <Card>
                <CardHeader>
                  <CardTitle className="text-base flex items-center gap-2">
                    <Users className="h-4 w-4" />
                    Called By ({dependencies.called_by.length})
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {dependencies.called_by.length === 0 ? (
                    <p className="text-sm text-muted-foreground">No upstream dependencies</p>
                  ) : (
                    <div className="space-y-2">
                      {dependencies.called_by.map((dep) => (
                        <div
                          key={dep.to}
                          className="flex items-center justify-between p-2 rounded border"
                        >
                          <div className="flex items-center gap-2">
                            <div
                              className="w-3 h-3 rounded-full"
                              style={{ backgroundColor: getServiceColor(dep.to) }}
                            />
                            <span className="font-medium">{dep.to}</span>
                          </div>
                          <div className="flex items-center gap-4 text-sm text-muted-foreground">
                            <div>
                              <span className="font-medium text-foreground">
                                {dep.total_calls.toLocaleString()}
                              </span>
                              {' '}calls
                            </div>
                            <div>
                              <span className="font-medium text-foreground">
                                {dep.trace_count.toLocaleString()}
                              </span>
                              {' '}traces
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-muted-foreground">Select a service to view dependencies</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
