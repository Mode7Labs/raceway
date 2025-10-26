import { useEffect, useState, useRef } from 'react';
import * as d3 from 'd3';
import { RacewayAPI } from '@/api';
import type { ServiceListItem } from '@/types';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';

interface ServiceDependencyGraphProps {
  services: ServiceListItem[];
}

type VisualizationType = 'force' | 'tree';

interface GraphNode {
  id: string;
  name: string;
  eventCount: number;
  x?: number;
  y?: number;
  fx?: number | null;
  fy?: number | null;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  value: number;
}

interface DependencyData {
  nodes: GraphNode[];
  links: GraphLink[];
}

export function ServiceDependencyGraph({ services }: ServiceDependencyGraphProps) {
  const [vizType, setVizType] = useState<VisualizationType>('force');
  const [data, setData] = useState<DependencyData | null>(null);
  const [initialLoading, setInitialLoading] = useState(true);
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const fetchDistributedEdges = async () => {
      try {
        // Fetch system-wide distributed edges
        const response = await RacewayAPI.getDistributedEdges();

        if (!response.data || response.data.edges.length === 0) {
          setData({ nodes: [], links: [] });
          setInitialLoading(false);
          return;
        }

        // Build nodes from unique services in edges
        const serviceSet = new Set<string>();
        response.data.edges.forEach((edge) => {
          serviceSet.add(edge.from_service);
          serviceSet.add(edge.to_service);
        });

        // Create nodes with event counts from services list
        const nodes: GraphNode[] = Array.from(serviceSet).map((serviceName) => {
          const serviceInfo = services.find((s) => s.name === serviceName);
          return {
            id: serviceName,
            name: serviceName,
            eventCount: serviceInfo?.event_count || 0,
          };
        });

        // Create links from distributed edges
        const links: GraphLink[] = response.data.edges.map((edge) => ({
          source: edge.from_service,
          target: edge.to_service,
          value: edge.call_count,
        }));

        setData({ nodes, links });
      } catch (error) {
        console.error('Error fetching distributed edges:', error);
        setData({ nodes: [], links: [] });
      } finally {
        setInitialLoading(false);
      }
    };

    fetchDistributedEdges();
  }, [services]);

  useEffect(() => {
    if (!data || !svgRef.current || initialLoading) return;

    // Clear previous visualization
    d3.select(svgRef.current).selectAll('*').remove();

    if (vizType === 'force') {
      renderForceGraph(data);
    } else {
      renderTreeGraph(data);
    }
  }, [data, vizType, initialLoading]);

  const renderForceGraph = (graphData: DependencyData) => {
    if (!svgRef.current) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const svg = d3.select(svgRef.current);

    // Create a group for zoom
    const g = svg.append('g');

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Create simulation
    const simulation = d3.forceSimulation(graphData.nodes as d3.SimulationNodeDatum[])
      .force('link', d3.forceLink(graphData.links).id((d: any) => d.id).distance(100))
      .force('charge', d3.forceManyBody().strength(-300))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(40));

    // Create arrow markers
    svg.append('defs').selectAll('marker')
      .data(['end'])
      .join('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 30)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', '#64748b');

    // Create links
    const link = g.append('g')
      .selectAll('line')
      .data(graphData.links)
      .join('line')
      .attr('stroke', '#64748b')
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', (d) => Math.sqrt(d.value) / 10)
      .attr('marker-end', 'url(#arrow)');

    // Create nodes
    const node = g.append('g')
      .selectAll('g')
      .data(graphData.nodes)
      .join('g')
      .call(d3.drag<SVGGElement, GraphNode>()
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
      .attr('r', (d) => Math.max(20, Math.sqrt(d.eventCount) / 10))
      .attr('fill', '#3b82f6')
      .attr('stroke', '#1e40af')
      .attr('stroke-width', 2);

    // Add labels
    node.append('text')
      .text((d) => d.name)
      .attr('x', 0)
      .attr('y', 4)
      .attr('text-anchor', 'middle')
      .attr('fill', 'white')
      .attr('font-size', '10px')
      .attr('font-weight', 'bold')
      .attr('pointer-events', 'none');

    // Update positions on tick
    simulation.on('tick', () => {
      link
        .attr('x1', (d: any) => d.source.x)
        .attr('y1', (d: any) => d.source.y)
        .attr('x2', (d: any) => d.target.x)
        .attr('y2', (d: any) => d.target.y);

      node.attr('transform', (d: any) => `translate(${d.x},${d.y})`);
    });
  };

  const renderTreeGraph = (graphData: DependencyData) => {
    if (!svgRef.current) return;

    const width = svgRef.current.clientWidth;
    const height = svgRef.current.clientHeight;

    const svg = d3.select(svgRef.current);

    // Create a group for zoom
    const g = svg.append('g');

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 4])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
      });

    svg.call(zoom);

    // Build tree structure from graph
    // Find root nodes (nodes with no incoming edges)
    const hasIncoming = new Set(graphData.links.map((l) =>
      typeof l.target === 'string' ? l.target : l.target.id
    ));
    const rootNodes = graphData.nodes.filter((n) => !hasIncoming.has(n.id));

    if (rootNodes.length === 0 && graphData.nodes.length > 0) {
      // If no clear roots, use the node with most outgoing connections
      const outgoingCounts = new Map<string, number>();
      graphData.links.forEach((link) => {
        const sourceId = typeof link.source === 'string' ? link.source : link.source.id;
        outgoingCounts.set(sourceId, (outgoingCounts.get(sourceId) || 0) + 1);
      });
      const maxNode = graphData.nodes.reduce((max, node) =>
        (outgoingCounts.get(node.id) || 0) > (outgoingCounts.get(max.id) || 0) ? node : max
      );
      rootNodes.push(maxNode);
    }

    // Build hierarchy
    const buildHierarchy = (nodeId: string, visited = new Set<string>()): any => {
      if (visited.has(nodeId)) return null;
      visited.add(nodeId);

      const node = graphData.nodes.find((n) => n.id === nodeId);
      if (!node) return null;

      const children = graphData.links
        .filter((l) => (typeof l.source === 'string' ? l.source : l.source.id) === nodeId)
        .map((l) => typeof l.target === 'string' ? l.target : l.target.id)
        .map((childId) => buildHierarchy(childId, new Set(visited)))
        .filter(Boolean);

      return {
        name: node.name,
        children: children.length > 0 ? children : undefined,
        value: node.eventCount,
      };
    };

    const hierarchyData = {
      name: 'Services',
      children: rootNodes.map((root) => buildHierarchy(root.id)).filter(Boolean),
    };

    // Create tree layout
    const root = d3.hierarchy(hierarchyData);
    const treeLayout = d3.tree<any>().size([height - 100, width - 200]);
    treeLayout(root);

    // Center the tree
    g.attr('transform', `translate(100, 50)`);

    // Create links
    g.selectAll('.link')
      .data(root.links())
      .join('path')
      .attr('class', 'link')
      .attr('d', d3.linkHorizontal()
        .x((d: any) => d.y)
        .y((d: any) => d.x)
      )
      .attr('fill', 'none')
      .attr('stroke', '#64748b')
      .attr('stroke-width', 2);

    // Create nodes
    const nodes = g.selectAll('.node')
      .data(root.descendants())
      .join('g')
      .attr('class', 'node')
      .attr('transform', (d: any) => `translate(${d.y},${d.x})`);

    nodes.append('circle')
      .attr('r', 20)
      .attr('fill', '#3b82f6')
      .attr('stroke', '#1e40af')
      .attr('stroke-width', 2);

    nodes.append('text')
      .text((d: any) => d.data.name)
      .attr('x', 25)
      .attr('y', 4)
      .attr('fill', 'currentColor')
      .attr('font-size', '12px');
  };

  if (initialLoading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">Loading dependency graph...</div>
      </div>
    );
  }

  if (!data || data.nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-muted-foreground">No dependency data available</div>
      </div>
    );
  }

  return (
    <div className="space-y-4 h-full flex flex-col">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold mb-2">Service Dependency Graph</h2>
          <p className="text-sm text-muted-foreground">
            Visual map of service relationships ({data.nodes.length} services, {data.links.length} dependencies)
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            variant={vizType === 'force' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setVizType('force')}
          >
            Force Graph
          </Button>
          <Button
            variant={vizType === 'tree' ? 'default' : 'outline'}
            size="sm"
            onClick={() => setVizType('tree')}
          >
            Tree View
          </Button>
        </div>
      </div>

      <Card className="flex-1 bg-card/50 border-border/50">
        <CardContent className="p-0 h-full">
          <svg
            ref={svgRef}
            className="w-full h-full"
            style={{ minHeight: '500px' }}
          />
        </CardContent>
      </Card>

      <div className="text-xs text-muted-foreground">
        {vizType === 'force' ? (
          <div className="space-y-1">
            <div>• Drag nodes to reposition them</div>
            <div>• Scroll to zoom in/out</div>
            <div>• Node size represents event count</div>
            <div>• Arrow thickness represents call frequency</div>
          </div>
        ) : (
          <div className="space-y-1">
            <div>• Hierarchical view of service dependencies</div>
            <div>• Scroll to zoom in/out</div>
            <div>• Left-to-right flow shows call direction</div>
          </div>
        )}
      </div>
    </div>
  );
}
