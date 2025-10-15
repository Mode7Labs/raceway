import { useState } from 'react';
import { type Event } from '../types';
import { cn } from '@/lib/utils';
import { Badge } from './ui/badge';
import { getEventKindColor } from '@/lib/event-colors';

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

export function TreeView({ events, selectedEventId, onEventSelect }: TreeViewProps) {
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  const getEventKind = (kind: Record<string, any>): string => {
    if (typeof kind === 'string') return kind;
    const keys = Object.keys(kind);
    if (keys.length > 0) {
      const key = keys[0];
      const value = kind[key];
      if (typeof value === 'object' && value !== null) {
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

  const buildTree = (): TreeNode[] => {
    const childrenMap = new Map<string, Event[]>();
    const roots: Event[] = [];

    // Build parent-child relationships
    for (const event of events) {
      if (event.parent_id) {
        const siblings = childrenMap.get(event.parent_id) || [];
        siblings.push(event);
        childrenMap.set(event.parent_id, siblings);
      } else {
        roots.push(event);
      }
    }

    const buildNode = (event: Event, depth: number): TreeNode => {
      const children = childrenMap.get(event.id) || [];
      return {
        event,
        depth,
        children: children.map((child) => buildNode(child, depth + 1)),
      };
    };

    return roots.map((root) => buildNode(root, 0));
  };

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

  const renderNode = (node: TreeNode): JSX.Element[] => {
    const isSelected = node.event.id === selectedEventId;
    const isCollapsed = collapsed.has(node.event.id);
    const hasChildren = node.children.length > 0;
    const eventKind = getEventKind(node.event.kind);
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
          <span className={cn(getEventKindColor(eventKind))}>{eventKind}</span>
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

  const tree = buildTree();

  return (
    <div className="space-y-0.5">
      {tree.flatMap((root) => renderNode(root))}
    </div>
  );
}
