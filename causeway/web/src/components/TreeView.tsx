import { useState, useMemo } from 'react';
import { type Event } from '../types';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { ChevronDown, ChevronRight, Clock, Layers } from 'lucide-react';
import { ServiceBadge } from './ServiceBadge';
import { EventKindBadge } from './EventKindBadge';

interface TreeViewProps {
  events: Event[];
  selectedEventId: string | null;
  onEventSelect: (eventId: string) => void;
}

interface TreeNode {
  event: Event;
  children: TreeNode[];
  depth: number;
}

interface TransactionGroup {
  id: string;
  title: string;
  service: string;
  rootEvent: Event;
  allEvents: Event[];
  tree: TreeNode[];
  startTime: number;
  endTime: number;
  duration: number;
}

export function TreeView({ events, selectedEventId, onEventSelect }: TreeViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  const getEventKind = (kind: Record<string, any>): string => {
    if (typeof kind === 'string') return kind;
    const keys = Object.keys(kind);
    if (keys.length > 0) {
      const key = keys[0];
      const value = kind[key];
      if (typeof value === 'object' && value !== null) {
        // For StateChange, extract the access_type value
        if (key === 'StateChange' && value.access_type) {
          return `StateChange | ${value.access_type}`;
        }

        // For HttpRequest, show method and URL
        if (key === 'HttpRequest') {
          const method = value.method || 'GET';
          const url = value.url || value.path || 'unknown';
          return `HttpRequest | ${method} ${url}`;
        }

        // For HttpResponse, show status code
        if (key === 'HttpResponse') {
          const status = value.status || value.status_code || '200';
          return `HttpResponse | ${status}`;
        }

        // For FunctionCall, show function name
        if (key === 'FunctionCall') {
          const funcName = value.function_name || value.name || 'unknown';
          return `FunctionCall | ${funcName}`;
        }

        // For LockAcquire, show lock type and lock ID
        if (key === 'LockAcquire') {
          const lockType = value.lock_type || 'Mutex';
          const lockId = value.lock_id || 'unknown';
          return `LockAcquire | ${lockType} | ${lockId}`;
        }

        // For LockRelease, show lock type and lock ID
        if (key === 'LockRelease') {
          const lockType = value.lock_type || 'Mutex';
          const lockId = value.lock_id || 'unknown';
          return `LockRelease | ${lockType} | ${lockId}`;
        }

        // Default: show key::subkey if there are nested keys
        const subKeys = Object.keys(value);
        if (subKeys.length > 0) {
          return `${key}::${subKeys[0]}`;
        }
      }
      return key;
    }
    return 'Unknown';
  };

  const formatTimestamp = (timestamp: string): string => {
    try {
      const date = new Date(timestamp);
      return date.toISOString().substring(11, 23);
    } catch {
      return timestamp;
    }
  };

  // Unused - transactionGroups builds its own tree structure
  // const buildTree = (): TreeNode[] => {
  //   const childrenMap = new Map<string, Event[]>();
  //   const roots: Event[] = [];

  //   // Build parent-child relationships
  //   for (const event of events) {
  //     if (event.parent_id) {
  //       const siblings = childrenMap.get(event.parent_id) || [];
  //       siblings.push(event);
  //       childrenMap.set(event.parent_id, siblings);
  //     } else {
  //       roots.push(event);
  //     }
  //   }

  //   const buildNode = (event: Event, depth: number): TreeNode => {
  //     const children = childrenMap.get(event.id) || [];
  //     return {
  //       event,
  //       depth,
  //       children: children.map((child) => buildNode(child, depth + 1)),
  //     };
  //   };

  //   return roots.map((root) => buildNode(root, 0));
  // };

  // Check if an event is an HTTP request (transaction root candidate)
  const isHttpRequest = (event: Event): boolean => {
    if (typeof event.kind === 'string') return false;
    return 'HttpRequest' in event.kind;
  };

  // Extract transaction title from HTTP request
  const getTransactionTitle = (event: Event): string => {
    if (typeof event.kind === 'object' && 'HttpRequest' in event.kind) {
      const request = event.kind.HttpRequest;
      const method = request.method || 'GET';
      const path = request.url || request.path || '/';
      return `${method} ${path}`;
    }
    return getEventKind(event.kind);
  };

  // Get all descendant events recursively
  const getAllDescendants = (eventId: string, childrenMap: Map<string, Event[]>): Event[] => {
    const children = childrenMap.get(eventId) || [];
    const descendants: Event[] = [...children];
    children.forEach(child => {
      descendants.push(...getAllDescendants(child.id, childrenMap));
    });
    return descendants;
  };

  // Build transaction groups
  const transactionGroups = useMemo((): TransactionGroup[] => {
    if (events.length === 0) return [];

    // Build parent-child map
    const childrenMap = new Map<string, Event[]>();
    for (const event of events) {
      if (event.parent_id) {
        const siblings = childrenMap.get(event.parent_id) || [];
        siblings.push(event);
        childrenMap.set(event.parent_id, siblings);
      }
    }

    // Build tree nodes helper
    const buildNode = (event: Event, depth: number): TreeNode => {
      const children = childrenMap.get(event.id) || [];
      return {
        event,
        depth,
        children: children.map((child) => buildNode(child, depth + 1)),
      };
    };

    // Find transaction roots (HttpRequest events without HttpRequest parents)
    const transactionRoots: Event[] = [];
    const processedEvents = new Set<string>();

    for (const event of events) {
      if (processedEvents.has(event.id)) continue;

      if (isHttpRequest(event)) {
        // Check if this is truly a root (no HttpRequest parent)
        let isRoot = true;
        let current = event;

        while (current.parent_id) {
          const parent = events.find(e => e.id === current.parent_id);
          if (parent && isHttpRequest(parent)) {
            isRoot = false;
            break;
          }
          if (!parent) break;
          current = parent;
        }

        if (isRoot) {
          transactionRoots.push(event);
        }
      }
    }

    // Build groups for each transaction root
    const groups: TransactionGroup[] = transactionRoots.map(rootEvent => {
      const allEvents = [rootEvent, ...getAllDescendants(rootEvent.id, childrenMap)];

      // Mark all events as processed
      allEvents.forEach(e => processedEvents.add(e.id));

      // Calculate timing
      const timestamps = allEvents.map(e => new Date(e.timestamp).getTime());
      const startTime = Math.min(...timestamps);
      const endTime = Math.max(...timestamps);
      const duration = endTime - startTime;

      // Build tree for this group
      const tree = [buildNode(rootEvent, 0)];

      return {
        id: rootEvent.id,
        title: getTransactionTitle(rootEvent),
        service: rootEvent.metadata.service_name,
        rootEvent,
        allEvents,
        tree,
        startTime,
        endTime,
        duration,
      };
    });

    // Add ungrouped events (events not part of any HttpRequest transaction)
    const ungroupedEvents = events.filter(e => !processedEvents.has(e.id));
    if (ungroupedEvents.length > 0) {
      // Group by root events
      const ungroupedRoots = ungroupedEvents.filter(e => !e.parent_id);

      ungroupedRoots.forEach(rootEvent => {
        const allEvents = [rootEvent, ...getAllDescendants(rootEvent.id, childrenMap)];
        const timestamps = allEvents.map(e => new Date(e.timestamp).getTime());
        const startTime = Math.min(...timestamps);
        const endTime = Math.max(...timestamps);
        const duration = endTime - startTime;

        groups.push({
          id: rootEvent.id,
          title: getEventKind(rootEvent.kind),
          service: rootEvent.metadata.service_name,
          rootEvent,
          allEvents,
          tree: [buildNode(rootEvent, 0)],
          startTime,
          endTime,
          duration,
        });
      });
    }

    // Sort groups by timestamp
    return groups.sort((a, b) => a.startTime - b.startTime);
  }, [events]);

  const toggleCollapse = (eventId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsed((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(eventId)) {
        newSet.delete(eventId);
      } else {
        newSet.add(eventId);
      }
      return newSet;
    });
  };

  const toggleGroupCollapse = (groupId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setCollapsedGroups((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(groupId)) {
        newSet.delete(groupId);
      } else {
        newSet.add(groupId);
      }
      return newSet;
    });
  };

  const renderNode = (node: TreeNode): JSX.Element[] => {
    const isSelected = node.event.id === selectedEventId;
    const isCollapsed = collapsed.has(node.event.id);
    const hasChildren = node.children.length > 0;
    const timestamp = formatTimestamp(node.event.timestamp);

    const elements: JSX.Element[] = [
      <button
        key={node.event.id}
        onClick={() => onEventSelect(node.event.id)}
        className={cn(
          "w-full text-left px-3 py-2 rounded-md font-mono text-xs transition-all hover:bg-accent/50 cursor-pointer flex items-center justify-between gap-2",
          isSelected && "bg-muted"
        )}
        style={{ paddingLeft: `${node.depth * 20 + 12}px` }}
      >
        <div className="flex items-center gap-2 min-w-0">
          {hasChildren ? (
            <button
              onClick={(e) => toggleCollapse(node.event.id, e)}
              className="flex-shrink-0 w-3 h-3 flex items-center justify-center hover:bg-accent rounded transition-colors"
            >
              <svg
                className={cn("w-2.5 h-2.5 transition-transform", isCollapsed && "-rotate-90")}
                viewBox="0 0 12 12"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M3 4.5L6 7.5L9 4.5"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </button>
          ) : (
            <span className="flex-shrink-0 w-3 h-3 flex items-center justify-center text-muted-foreground/40 text-[10px]">
              -
            </span>
          )}
          <span className="text-muted-foreground text-[11px]">{timestamp}</span>
          <EventKindBadge eventKind={node.event.kind} />
          {hasChildren && (
            <Badge variant="outline" className="text-[10px] text-yellow-400/90 border-yellow-500/20 bg-yellow-500/5">
              {node.children.length}
            </Badge>
          )}
        </div>
        {isSelected && (
          <svg className="w-3 h-3 flex-shrink-0 text-primary" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        )}
      </button>
    ];

    // Recursively render children if not collapsed
    if (!isCollapsed) {
      node.children.forEach((child) => {
        elements.push(...renderNode(child));
      });
    }

    return elements;
  };

  return (
    <div className="space-y-2">
      {transactionGroups.map((group) => {
        const isGroupCollapsed = collapsedGroups.has(group.id);
        const hasSelectedEvent = group.allEvents.some(e => e.id === selectedEventId);

        return (
          <div key={group.id} className="space-y-0.5">
            {/* Transaction Group Header */}
            <button
              onClick={(e) => toggleGroupCollapse(group.id, e)}
              className={cn(
                "w-full text-left px-3 py-2.5 rounded-md transition-all hover:bg-accent/50 cursor-pointer border-l-2",
                hasSelectedEvent ? "border-primary bg-primary/5" : "border-muted bg-muted/30"
              )}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0 flex-1">
                  {/* Expand/Collapse Icon */}
                  {isGroupCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                  )}

                  {/* Transaction Title */}
                  <div className="flex items-center gap-2 min-w-0">
                    <Layers className="h-3.5 w-3.5 flex-shrink-0 text-blue-400" />
                    <span className="font-medium text-sm truncate text-foreground">
                      {group.title}
                    </span>
                  </div>
                </div>

                {/* Metadata */}
                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Service Badge */}
                  <ServiceBadge
                    serviceName={group.service}
                    tags={group.rootEvent.metadata.tags}
                  />

                  {/* Event Count */}
                  <Badge variant="outline" className="text-[10px] text-muted-foreground">
                    {group.allEvents.length} events
                  </Badge>

                  {/* Duration */}
                  <div className="flex items-center gap-1 text-[11px] text-muted-foreground font-mono">
                    <Clock className="h-3 w-3" />
                    <span>{group.duration.toFixed(1)}ms</span>
                  </div>
                </div>
              </div>

              {/* Trace ID (short) */}
              <div className="mt-1 ml-5 text-[10px] text-muted-foreground/70 font-mono">
                trace: {group.rootEvent.trace_id.substring(0, 12)}...
              </div>
            </button>

            {/* Transaction Events */}
            {!isGroupCollapsed && (
              <div className="ml-2 space-y-0.5 border-l border-border/50 pl-1">
                {group.tree.flatMap((root) => renderNode(root))}
              </div>
            )}
          </div>
        );
      })}

      {transactionGroups.length === 0 && (
        <div className="text-center py-8 text-muted-foreground text-sm">
          No events to display
        </div>
      )}
    </div>
  );
}
