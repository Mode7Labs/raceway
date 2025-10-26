import { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import * as d3 from 'd3';
import type { Event } from '@/types';
import { Card, CardContent } from './ui/card';
import { Button } from './ui/button';
import { ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';

interface TraceDAGViewProps {
  events: Event[];
  selectedEventId: string | null;
  onEventSelect: (eventId: string) => void;
  highlightEventIds?: string[];
}

interface DAGNode extends d3.SimulationNodeDatum {
  id: string;
  event: Event;
  label: string;
  service: string;
  level: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface DAGLink extends d3.SimulationLinkDatum<DAGNode> {
  source: string | DAGNode;
  target: string | DAGNode;
  type: 'parent' | 'causal'; // parent = direct parent_id, causal = happens-before from vector clocks
}

const SERVICE_COLORS: Record<string, string> = {
  'typescript-service': '#3b82f6',
  'python-service': '#10b981',
  'go-service': '#f59e0b',
  'rust-service': '#ef4444',
};

export function TraceDAGView({
  events,
  selectedEventId,
  onEventSelect,
  highlightEventIds = []
}: TraceDAGViewProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [zoomLevel, setZoomLevel] = useState(1);
  const zoomTransformRef = useRef<d3.ZoomTransform | null>(null);
  const isInitialRenderRef = useRef(true);
  const simulationRef = useRef<d3.Simulation<DAGNode, DAGLink> | null>(null);

  // Memoize the DAG structure - only rebuild when event IDs actually change
  const dagStructure = useMemo(() => {
    if (events.length === 0) return null;

    // Helper function to check if event A happens before event B based on vector clocks
    const happensBefore = (vecA: Array<[string, number]>, vecB: Array<[string, number]>): boolean => {
      const mapA = new Map(vecA);
      const mapB = new Map(vecB);

      let hasLessThan = false;
      const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

      for (const key of allKeys) {
        const valA = mapA.get(key) || 0;
        const valB = mapB.get(key) || 0;

        if (valA > valB) return false; // A cannot happen before B
        if (valA < valB) hasLessThan = true;
      }

      return hasLessThan;
    };

    // Build DAG structure from events
    const nodes: DAGNode[] = events.map(event => {
      const eventKind = getEventKind(event.kind);
      return {
        id: event.id,
        event,
        label: eventKind,
        service: event.metadata.service_name || 'unknown',
        level: 0,
      };
    });

    // Create links based on parent_id
    const parentLinks: DAGLink[] = events
      .filter(event => event.parent_id)
      .map(event => ({
        source: event.parent_id!,
        target: event.id,
        type: 'parent' as const,
      }));

    // Create causal links based on vector clocks (happens-before relationships)
    const causalLinks: DAGLink[] = [];
    const parentSet = new Set(parentLinks.map(l => `${l.source}->${l.target}`));

    for (let i = 0; i < events.length; i++) {
      for (let j = 0; j < events.length; j++) {
        if (i === j) continue;

        const eventA = events[i];
        const eventB = events[j];

        // Check if A happens before B
        if (happensBefore(eventA.causality_vector, eventB.causality_vector)) {
          // Don't add if this is already a parent link
          const linkKey = `${eventA.id}->${eventB.id}`;
          if (!parentSet.has(linkKey)) {
            // Check if this is a direct causal relationship (no intermediate events)
            let isDirect = true;
            for (let k = 0; k < events.length; k++) {
              if (k === i || k === j) continue;
              const eventC = events[k];
              // If C is between A and B in the happens-before order, skip this link
              if (happensBefore(eventA.causality_vector, eventC.causality_vector) &&
                  happensBefore(eventC.causality_vector, eventB.causality_vector)) {
                isDirect = false;
                break;
              }
            }

            if (isDirect) {
              causalLinks.push({
                source: eventA.id,
                target: eventB.id,
                type: 'causal' as const,
              });
            }
          }
        }
      }
    }

    const links: DAGLink[] = [...parentLinks, ...causalLinks];

    // Calculate levels (depth in tree)
    const levelMap = new Map<string, number>();
    const calculateLevel = (nodeId: string, visited = new Set<string>()): number => {
      if (levelMap.has(nodeId)) return levelMap.get(nodeId)!;
      if (visited.has(nodeId)) return 0; // Circular reference protection

      visited.add(nodeId);
      const node = events.find(e => e.id === nodeId);
      if (!node || !node.parent_id) {
        levelMap.set(nodeId, 0);
        return 0;
      }

      const parentLevel = calculateLevel(node.parent_id, visited);
      const level = parentLevel + 1;
      levelMap.set(nodeId, level);
      return level;
    };

    events.forEach(event => calculateLevel(event.id));
    nodes.forEach(node => {
      node.level = levelMap.get(node.id) || 0;
    });

    return { nodes, links };
  }, [events]);

  // Main effect - build the graph structure only when DAG changes
  useEffect(() => {
    if (!svgRef.current || !dagStructure) return;

    // Stop previous simulation
    if (simulationRef.current) {
      simulationRef.current.stop();
    }

    // Clear previous visualization
    d3.select(svgRef.current).selectAll('*').remove();

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;
    const { nodes, links } = dagStructure;

    // SVG setup
    const svg = d3.select(svgRef.current);
    const g = svg.append('g');

    // Zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        setZoomLevel(event.transform.k);
        zoomTransformRef.current = event.transform;
      });

    svg.call(zoom);

    // Arrow markers - parent links (solid arrows)
    svg.append('defs')
      .selectAll('marker.parent')
      .data(['arrow-parent', 'arrow-parent-highlight', 'arrow-parent-selected'])
      .join('marker')
      .attr('class', 'parent')
      .attr('id', d => d)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 25)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', d => {
        if (d === 'arrow-parent-highlight') return '#f59e0b';
        if (d === 'arrow-parent-selected') return '#3b82f6';
        return '#64748b';
      });

    // Arrow markers - causal links (outlined arrows)
    svg.append('defs')
      .selectAll('marker.causal')
      .data(['arrow-causal', 'arrow-causal-highlight', 'arrow-causal-selected'])
      .join('marker')
      .attr('class', 'causal')
      .attr('id', d => d)
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 25)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', 'none')
      .attr('stroke', d => {
        if (d === 'arrow-causal-highlight') return '#f59e0b';
        if (d === 'arrow-causal-selected') return '#3b82f6';
        return '#a855f7';
      })
      .attr('stroke-width', 1.5);

    // Create force simulation
    const simulation = d3.forceSimulation(nodes as d3.SimulationNodeDatum[])
      .force('link', d3.forceLink(links).id((d: any) => d.id).distance(80))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('x', d3.forceX((d: any) => {
        // Spread horizontally by level, centered around 0
        const maxLevel = Math.max(...nodes.map(n => n.level));
        const offset = (maxLevel * 150) / 2;
        return (d.level * 150) - offset;
      }).strength(0.5))
      .force('y', d3.forceY(0).strength(0.3))
      .force('collision', d3.forceCollide().radius(30));

    // Store simulation ref
    simulationRef.current = simulation;

    // Create links
    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', (d: any) => {
        const targetId = typeof d.target === 'string' ? d.target : d.target.id;
        const sourceId = typeof d.source === 'string' ? d.source : d.source.id;

        if (selectedEventId && (sourceId === selectedEventId || targetId === selectedEventId)) {
          return '#3b82f6';
        }
        if (highlightEventIds.length > 0 &&
            (highlightEventIds.includes(sourceId) || highlightEventIds.includes(targetId))) {
          return '#f59e0b';
        }
        // Different colors for parent vs causal links
        return d.type === 'causal' ? '#a855f7' : '#64748b';
      })
      .attr('stroke-opacity', (d: any) => {
        const targetId = typeof d.target === 'string' ? d.target : d.target.id;
        const sourceId = typeof d.source === 'string' ? d.source : d.source.id;

        if (selectedEventId && (sourceId === selectedEventId || targetId === selectedEventId)) {
          return 0.9;
        }
        if (highlightEventIds.length > 0 &&
            (highlightEventIds.includes(sourceId) || highlightEventIds.includes(targetId))) {
          return 0.8;
        }
        return d.type === 'causal' ? 0.5 : 0.3;
      })
      .attr('stroke-width', (d: any) => {
        const targetId = typeof d.target === 'string' ? d.target : d.target.id;
        const sourceId = typeof d.source === 'string' ? d.source : d.source.id;

        if (selectedEventId && (sourceId === selectedEventId || targetId === selectedEventId)) {
          return 3;
        }
        if (highlightEventIds.length > 0 &&
            (highlightEventIds.includes(sourceId) || highlightEventIds.includes(targetId))) {
          return 2.5;
        }
        return d.type === 'causal' ? 2 : 1.5;
      })
      .attr('stroke-dasharray', (d: any) => {
        // Dashed lines for causal links
        return d.type === 'causal' ? '5,3' : 'none';
      })
      .attr('marker-end', (d: any) => {
        const targetId = typeof d.target === 'string' ? d.target : d.target.id;
        const sourceId = typeof d.source === 'string' ? d.source : d.source.id;
        const linkType = d.type === 'causal' ? 'causal' : 'parent';

        if (selectedEventId && (sourceId === selectedEventId || targetId === selectedEventId)) {
          return `url(#arrow-${linkType}-selected)`;
        }
        if (highlightEventIds.length > 0 &&
            (highlightEventIds.includes(sourceId) || highlightEventIds.includes(targetId))) {
          return `url(#arrow-${linkType}-highlight)`;
        }
        return `url(#arrow-${linkType})`;
      });

    // Create node groups
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .on('click', (event, d) => {
        event.stopPropagation();
        onEventSelect(d.id);
      })
      .call(d3.drag<SVGGElement, DAGNode>()
        .on('start', (event, d: any) => {
          if (!event.active) simulation.alphaTarget(0.3).restart();
          d.fx = d.x;
          d.fy = d.y;
        })
        .on('drag', (event, d: any) => {
          d.fx = event.x;
          d.fy = event.y;
        })
        .on('end', (event, d: any) => {
          if (!event.active) simulation.alphaTarget(0);
          d.fx = null;
          d.fy = null;
        })
      );

    // Add circles
    node.append('circle')
      .attr('r', (d) => {
        if (d.id === selectedEventId) return 22;
        if (highlightEventIds.includes(d.id)) return 20;
        return 18;
      })
      .attr('fill', d => SERVICE_COLORS[d.service] || '#6b7280')
      .attr('stroke', (d) => {
        if (d.id === selectedEventId) return '#1e40af';
        if (highlightEventIds.includes(d.id)) return '#d97706';
        return 'none';
      })
      .attr('stroke-width', (d) => {
        if (d.id === selectedEventId) return 3;
        if (highlightEventIds.includes(d.id)) return 2.5;
        return 0;
      })
      .attr('opacity', (d) => {
        if (selectedEventId && d.id !== selectedEventId) return 0.4;
        return 1;
      });

    // Add labels
    node.append('text')
      .text(d => {
        // Show short event kind
        const kind = d.label.split('::')[0];
        return kind.length > 8 ? kind.substring(0, 8) + '...' : kind;
      })
      .attr('x', 0)
      .attr('y', 4)
      .attr('text-anchor', 'middle')
      .attr('fill', 'white')
      .attr('font-size', '9px')
      .attr('font-weight', 'bold')
      .attr('pointer-events', 'none');

    // Add tooltips
    node.append('title')
      .text(d => {
        const timestamp = new Date(d.event.timestamp).toISOString().substring(11, 23);
        const vectorClock = d.event.causality_vector
          .map(([id, count]) => `${id.substring(0, 8)}:${count}`)
          .join(', ');
        return `${d.label}\n${d.service}\nTime: ${timestamp}\nLevel: ${d.level}\nVector: [${vectorClock}]\nID: ${d.id.substring(0, 8)}`;
      });

    // Update positions on tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });

    // Apply zoom transform - only reset on initial render or when DAG structure changes
    if (isInitialRenderRef.current || !zoomTransformRef.current) {
      const initialScale = 0.8;
      // Center the graph in the viewport
      const transform = d3.zoomIdentity
        .translate(width / 2, height / 2)
        .scale(initialScale);

      svg.call(zoom.transform as any, transform);
      zoomTransformRef.current = transform;
      isInitialRenderRef.current = false;
    } else {
      // Restore previous zoom state
      svg.call(zoom.transform as any, zoomTransformRef.current);
    }

    return () => {
      simulation.stop();
    };
  }, [dagStructure]);

  // Separate effect for updating visual styling when selection/highlighting changes
  useEffect(() => {
    if (!svgRef.current || !dagStructure) return;

    const svg = d3.select(svgRef.current);
    const g = svg.select('g');

    // Update link styling
    g.selectAll<SVGLineElement, DAGLink>('line')
      .attr('stroke', (d: any) => {
        const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
        const targetId = typeof d.target === 'object' ? d.target.id : d.target;
        if (selectedEventId && (sourceId === selectedEventId || targetId === selectedEventId)) {
          return '#3b82f6';
        }
        if (highlightEventIds.length > 0 &&
            (highlightEventIds.includes(sourceId) || highlightEventIds.includes(targetId))) {
          return '#f59e0b';
        }
        return d.type === 'causal' ? '#a855f7' : '#64748b';
      })
      .attr('stroke-opacity', (d: any) => {
        const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
        const targetId = typeof d.target === 'object' ? d.target.id : d.target;
        if (selectedEventId && (sourceId === selectedEventId || targetId === selectedEventId)) {
          return 0.9;
        }
        if (highlightEventIds.length > 0 &&
            (highlightEventIds.includes(sourceId) || highlightEventIds.includes(targetId))) {
          return 0.8;
        }
        return d.type === 'causal' ? 0.5 : 0.3;
      })
      .attr('stroke-width', (d: any) => {
        const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
        const targetId = typeof d.target === 'object' ? d.target.id : d.target;
        if (selectedEventId && (sourceId === selectedEventId || targetId === selectedEventId)) {
          return 3;
        }
        if (highlightEventIds.length > 0 &&
            (highlightEventIds.includes(sourceId) || highlightEventIds.includes(targetId))) {
          return 2.5;
        }
        return d.type === 'causal' ? 2 : 1.5;
      })
      .attr('stroke-dasharray', (d: any) => {
        return d.type === 'causal' ? '5,3' : 'none';
      })
      .attr('marker-end', (d: any) => {
        const sourceId = typeof d.source === 'object' ? d.source.id : d.source;
        const targetId = typeof d.target === 'object' ? d.target.id : d.target;
        const linkType = d.type === 'causal' ? 'causal' : 'parent';

        if (selectedEventId && (sourceId === selectedEventId || targetId === selectedEventId)) {
          return `url(#arrow-${linkType}-selected)`;
        }
        if (highlightEventIds.length > 0 &&
            (highlightEventIds.includes(sourceId) || highlightEventIds.includes(targetId))) {
          return `url(#arrow-${linkType}-highlight)`;
        }
        return `url(#arrow-${linkType})`;
      });

    // Update node circle styling
    g.selectAll<SVGCircleElement, DAGNode>('circle')
      .attr('r', (d) => {
        if (d.id === selectedEventId) return 22;
        if (highlightEventIds.includes(d.id)) return 20;
        return 18;
      })
      .attr('stroke', (d) => {
        if (d.id === selectedEventId) return '#1e40af';
        if (highlightEventIds.includes(d.id)) return '#d97706';
        return 'none';
      })
      .attr('stroke-width', (d) => {
        if (d.id === selectedEventId) return 3;
        if (highlightEventIds.includes(d.id)) return 2.5;
        return 0;
      })
      .attr('opacity', (d) => {
        if (selectedEventId && d.id !== selectedEventId) return 0.4;
        return 1;
      });
  }, [dagStructure, selectedEventId, highlightEventIds]);

  const handleZoomIn = () => {
    const svg = d3.select(svgRef.current);
    svg.transition().call((d3.zoom() as any).scaleBy, 1.3);
  };

  const handleZoomOut = () => {
    const svg = d3.select(svgRef.current);
    svg.transition().call((d3.zoom() as any).scaleBy, 0.7);
  };

  const handleResetZoom = () => {
    if (!svgRef.current) return;
    const svg = d3.select(svgRef.current);
    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;
    const initialScale = 0.8;
    // Center the graph in the viewport
    const transform = d3.zoomIdentity
      .translate(width / 2, height / 2)
      .scale(initialScale);

    svg.transition().call(
      (d3.zoom() as any).transform,
      transform
    );
    zoomTransformRef.current = transform;
  };

  if (!dagStructure) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">No events to display</div>
      </div>
    );
  }

  return (
    <div className="relative h-full w-full">
      <svg ref={svgRef} className="w-full h-full bg-background/30 rounded-lg" />

      {/* Zoom Controls */}
      <div className="absolute bottom-4 right-4 flex flex-col gap-2">
        <Button
          variant="secondary"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={handleZoomIn}
        >
          <ZoomIn className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={handleZoomOut}
        >
          <ZoomOut className="h-4 w-4" />
        </Button>
        <Button
          variant="secondary"
          size="sm"
          className="h-8 w-8 p-0"
          onClick={handleResetZoom}
        >
          <Maximize2 className="h-4 w-4" />
        </Button>
      </div>

      {/* Legend */}
      <Card className="absolute top-4 right-4 bg-card/90 backdrop-blur">
        <CardContent className="p-3">
          <div className="text-xs font-semibold mb-2">Services</div>
          <div className="space-y-1 mb-3">
            {Object.entries(SERVICE_COLORS).map(([service, color]) => (
              <div key={service} className="flex items-center gap-2 text-xs">
                <div
                  className="w-3 h-3 rounded-full"
                  style={{ backgroundColor: color }}
                />
                <span className="text-muted-foreground">{service.replace('-service', '')}</span>
              </div>
            ))}
          </div>
          <div className="border-t border-border pt-2 mb-2">
            <div className="text-xs font-semibold mb-2">Relationships</div>
            <div className="space-y-1">
              <div className="flex items-center gap-2 text-xs">
                <svg width="20" height="2">
                  <line x1="0" y1="1" x2="20" y2="1" stroke="#64748b" strokeWidth="1.5" />
                </svg>
                <span className="text-muted-foreground">Parent</span>
              </div>
              <div className="flex items-center gap-2 text-xs">
                <svg width="20" height="2">
                  <line x1="0" y1="1" x2="20" y2="1" stroke="#a855f7" strokeWidth="2" strokeDasharray="5,3" />
                </svg>
                <span className="text-muted-foreground">Causal</span>
              </div>
            </div>
          </div>
          <div className="text-[10px] text-muted-foreground mt-3">
            Zoom: {(zoomLevel * 100).toFixed(0)}%
          </div>
        </CardContent>
      </Card>

      {/* Instructions */}
      <div className="absolute bottom-4 left-4 bg-card/90 backdrop-blur rounded p-2 text-[10px] text-muted-foreground max-w-xs">
        <div className="font-semibold mb-1">Causal Graph</div>
        <div>• Solid arrows: direct parent-child relationships</div>
        <div>• Dashed arrows: happens-before (causal) relationships</div>
        <div className="mt-2">
          <div>• Click node to select event</div>
          <div>• Drag nodes to reposition</div>
          <div>• Scroll to zoom</div>
          <div>• Drag background to pan</div>
        </div>
      </div>
    </div>
  );
}

function getEventKind(kind: Record<string, any>): string {
  if (typeof kind === 'string') return kind;
  const keys = Object.keys(kind);
  if (keys.length > 0) {
    const key = keys[0];
    const value = kind[key];
    if (typeof value === 'object' && value !== null) {
      if (key === 'StateChange' && value.access_type) {
        return `${key}:${value.access_type}`;
      }
      const subKeys = Object.keys(value);
      if (subKeys.length > 0) {
        return `${key}::${subKeys[0]}`;
      }
    }
    return key;
  }
  return 'Unknown';
}
