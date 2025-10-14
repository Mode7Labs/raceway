import { type Event } from '../types';

interface TreeViewProps {
  events: Event[];
  selectedEventId: string | null;
  onEventSelect: (eventId: string) => void;
}

interface TreeNode {
  event: Event;
  children: TreeNode[];
  depth: number;
  isLastChild: boolean[];
}

export function TreeView({ events, selectedEventId, onEventSelect }: TreeViewProps) {
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

    const buildNode = (event: Event, depth: number, isLastChild: boolean[]): TreeNode => {
      const children = childrenMap.get(event.id) || [];
      return {
        event,
        depth,
        isLastChild,
        children: children.map((child, idx) =>
          buildNode(child, depth + 1, [...isLastChild, idx === children.length - 1])
        ),
      };
    };

    return roots.map((root, idx) => buildNode(root, 0, [idx === roots.length - 1]));
  };

  const renderNode = (node: TreeNode): JSX.Element[] => {
    const isSelected = node.event.id === selectedEventId;
    const eventKind = getEventKind(node.event.kind);
    const timestamp = formatTimestamp(node.event.timestamp);

    let prefix = '';

    // Build the tree visualization prefix
    for (let i = 0; i < node.isLastChild.length - 1; i++) {
      prefix += node.isLastChild[i] ? '    ' : '│   ';
    }

    if (node.depth > 0) {
      prefix += node.isLastChild[node.isLastChild.length - 1] ? '└── ' : '├── ';
    }

    const childrenIndicator = node.children.length > 0 ? ` [${node.children.length}]` : '';

    const elements: JSX.Element[] = [
      <div
        key={node.event.id}
        className={`tree-node ${isSelected ? 'selected' : ''}`}
        onClick={() => onEventSelect(node.event.id)}
        style={{ paddingLeft: `${node.depth * 20}px` }}
      >
        <span className="tree-prefix">{prefix}</span>
        <span className="event-timestamp">[{timestamp}]</span>
        <span className="event-kind">{eventKind}{childrenIndicator}</span>
      </div>
    ];

    // Recursively render children
    node.children.forEach((child) => {
      elements.push(...renderNode(child));
    });

    return elements;
  };

  const tree = buildTree();

  return (
    <div className="tree-view">
      {tree.flatMap((root) => renderNode(root))}
    </div>
  );
}
