import { cn } from '@/lib/utils';
import type { ServiceListItem } from '@/types';
import { ArrowRight } from 'lucide-react';

interface ServiceListProps {
  services: ServiceListItem[];
  selectedServiceName: string | null;
  onSelect: (serviceName: string | null) => void;
  onNavigateToServiceTraces?: (serviceName: string) => void;
  loading?: boolean;
}

export function ServiceList({ services, selectedServiceName, onSelect, onNavigateToServiceTraces, loading }: ServiceListProps) {
  return (
    <div className="space-y-1">
      {/* Individual services */}
      {loading ? (
        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
          Loading services...
        </div>
      ) : services.length === 0 ? (
        <div className="px-3 py-4 text-center text-xs text-muted-foreground">
          No services found
        </div>
      ) : (
        services.map((service) => {
          const isSelected = service.name === selectedServiceName;

          return (
            <div
              key={service.name}
              className={cn(
                "w-full flex flex-col items-start gap-1 px-3 py-2.5 rounded-md text-xs transition-all border group",
                "hover:bg-muted/50 hover:border-border",
                isSelected
                  ? "bg-muted border-border shadow-sm"
                  : "bg-transparent border-transparent"
              )}
              title={service.name}
            >
              <div className="w-full cursor-pointer" onClick={() => onSelect(service.name)}>
                <span className="text-foreground/90 text-xs">
                  {service.name}
                </span>
              </div>
              <div className="flex items-center justify-between w-full">
                <div className="flex items-center gap-2 text-[10px] text-muted-foreground cursor-pointer" onClick={() => onSelect(service.name)}>
                  <span>{service.event_count.toLocaleString()} events</span>
                  <span>•</span>
                  <span>{service.trace_count} traces</span>
                </div>
                {onNavigateToServiceTraces && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onNavigateToServiceTraces(service.name);
                    }}
                    className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-[9px] text-primary hover:underline"
                    title="View traces"
                  >
                    Traces
                    <ArrowRight className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            </div>
          );
        })
      )}
    </div>
  );
}
