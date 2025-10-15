import { useState } from 'react';
import { type Event } from '../types';
import { cn } from '@/lib/utils';
import { getThreadIdColor, getEventKindColor } from '@/lib/event-colors';
import { Badge } from './ui/badge';
import { Button } from './ui/button';
import { Copy, Check } from 'lucide-react';

interface EventDetailsProps {
  event: Event | undefined;
}

export function EventDetails({ event }: EventDetailsProps) {
  const [copiedField, setCopiedField] = useState<string | null>(null);

  if (!event) {
    return (
      <div className="flex flex-col items-center justify-center h-32 text-center">
        <div className="text-muted-foreground text-xs">Select an event to view details</div>
        <div className="text-muted-foreground text-[10px] mt-1">Click on any event in the list</div>
      </div>
    );
  }

  const formatJSON = (obj: any): string => {
    return JSON.stringify(obj, null, 2);
  };

  const copyToClipboard = (text: string, field: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(null), 2000);
    });
  };

  const getEventKindDisplay = (kind: Event['kind']): string => {
    if (typeof kind === 'string') return kind;
    return Object.keys(kind)[0];
  };

  const getEventKindDetails = (kind: Event['kind']): any => {
    if (typeof kind === 'string') return null;
    return Object.values(kind)[0];
  };

  const kindDisplay = getEventKindDisplay(event.kind);
  const kindDetails = getEventKindDetails(event.kind);

  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toISOString();
    } catch {
      return timestamp;
    }
  };

  return (
    <div className="space-y-3">
      {/* Event Kind Badge */}
      <div className="flex items-center gap-2 pb-2 border-b border-border">
        <span className={cn("font-mono text-xs font-medium", getEventKindColor(kindDisplay))}>
          {kindDisplay}
        </span>
        {event.parent_id && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
            Has Parent
          </Badge>
        )}
        {event.lock_set.length > 0 && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0.5">
            {event.lock_set.length} Lock{event.lock_set.length > 1 ? 's' : ''}
          </Badge>
        )}
      </div>

      {/* Event ID with copy */}
      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase">Event ID</h4>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 px-1.5"
            onClick={() => copyToClipboard(event.id, 'eventId')}
          >
            {copiedField === 'eventId' ? (
              <Check className="h-3 w-3 text-green-400" />
            ) : (
              <Copy className="h-3 w-3" />
            )}
          </Button>
        </div>
        <div className="font-mono text-xs bg-muted p-2 rounded break-all text-cyan-400">{event.id}</div>
      </div>

      {/* Timestamp */}
      <div className="space-y-1">
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase">Timestamp</h4>
        <div className="text-xs bg-muted p-2 rounded text-amber-400">{formatTimestamp(event.timestamp)}</div>
      </div>

      {/* Metadata Quick View */}
      <div className="space-y-1">
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase">Metadata</h4>
        <div className="space-y-1 bg-muted p-2 rounded">
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-muted-foreground">Thread:</span>
            <span className={cn("font-mono text-xs", getThreadIdColor(event.metadata.thread_id))}>
              {event.metadata.thread_id}
            </span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-muted-foreground">Service:</span>
            <span className="font-mono text-xs text-blue-400">{event.metadata.service_name}</span>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-[10px] text-muted-foreground">Environment:</span>
            <span className="font-mono text-xs text-green-400">{event.metadata.environment}</span>
          </div>
        </div>
      </div>

      {/* Location */}
      {event.metadata.location && (
        <div className="space-y-1">
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase">Location</h4>
          <div className="font-mono text-[10px] bg-muted p-2 rounded break-all text-foreground">
            {event.metadata.location}
          </div>
        </div>
      )}

      {/* Event Kind Details */}
      {kindDetails && (
        <div className="space-y-1">
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase">Kind Details</h4>
          <pre className="font-mono text-[10px] bg-muted p-2 rounded overflow-x-auto text-muted-foreground leading-relaxed">
            {formatJSON(kindDetails)}
          </pre>
        </div>
      )}

      {/* Parent ID */}
      {event.parent_id && (
        <div className="space-y-1">
          <div className="flex items-center justify-between">
            <h4 className="text-[10px] font-semibold text-muted-foreground uppercase">Parent Event ID</h4>
            <Button
              variant="ghost"
              size="sm"
              className="h-5 px-1.5"
              onClick={() => copyToClipboard(event.parent_id!, 'parentId')}
            >
              {copiedField === 'parentId' ? (
                <Check className="h-3 w-3 text-green-400" />
              ) : (
                <Copy className="h-3 w-3" />
              )}
            </Button>
          </div>
          <div className="font-mono text-xs bg-muted p-2 rounded break-all text-purple-400">{event.parent_id}</div>
        </div>
      )}

      {/* Causality Vector */}
      <div className="space-y-1">
        <h4 className="text-[10px] font-semibold text-muted-foreground uppercase">Causality Vector</h4>
        <pre className="font-mono text-[10px] bg-muted p-2 rounded overflow-x-auto text-muted-foreground leading-relaxed">
          {formatJSON(event.causality_vector)}
        </pre>
      </div>

      {/* Lock Set */}
      {event.lock_set.length > 0 && (
        <div className="space-y-1">
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase">Lock Set ({event.lock_set.length})</h4>
          <pre className="font-mono text-[10px] bg-muted p-2 rounded overflow-x-auto text-muted-foreground leading-relaxed">
            {formatJSON(event.lock_set)}
          </pre>
        </div>
      )}

      {/* Tags if present */}
      {event.metadata.tags && Object.keys(event.metadata.tags).length > 0 && (
        <div className="space-y-1">
          <h4 className="text-[10px] font-semibold text-muted-foreground uppercase">Tags</h4>
          <pre className="font-mono text-[10px] bg-muted p-2 rounded overflow-x-auto text-muted-foreground leading-relaxed">
            {formatJSON(event.metadata.tags)}
          </pre>
        </div>
      )}
    </div>
  );
}
