import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { type DependenciesData } from '../types';

interface ServiceGraphProps {
  data: DependenciesData;
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: string;
  eventCount: number;
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  source: string | GraphNode;
  target: string | GraphNode;
  callCount: number;
}

export function ServiceGraph({ data }: ServiceGraphProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || data.services.length === 0) return;

    // Clear previous content
    d3.select(svgRef.current).selectAll('*').remove();

    // Get computed colors from CSS variables
    const computedStyle = getComputedStyle(svgRef.current);
    const foregroundColor = computedStyle.getPropertyValue('color') || '#fff';
    const mutedForegroundColor = computedStyle.getPropertyValue('--muted-foreground')
      ? `hsl(${computedStyle.getPropertyValue('--muted-foreground')})`
      : '#888';
    const backgroundColor = computedStyle.getPropertyValue('--background')
      ? `hsl(${computedStyle.getPropertyValue('--background')})`
      : '#000';
    const primaryColor = computedStyle.getPropertyValue('--primary')
      ? `hsl(${computedStyle.getPropertyValue('--primary')})`
      : '#0ea5e9';
    const borderColor = computedStyle.getPropertyValue('--border')
      ? `hsl(${computedStyle.getPropertyValue('--border')})`
      : '#333';

    const width = 800;
    const height = 600;

    // Create nodes from services
    const nodes: GraphNode[] = data.services.map(service => ({
      id: service.name,
      eventCount: service.event_count,
    }));

    // Create links from dependencies
    const links: GraphLink[] = data.dependencies.map(dep => ({
      source: dep.from,
      target: dep.to,
      callCount: dep.call_count,
    }));

    // Create SVG
    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height])
      .attr('style', 'max-width: 100%; height: auto; cursor: grab;');

    // Create arrow markers for links
    svg.append('defs').selectAll('marker')
      .data(['end'])
      .join('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 -5 10 10')
      .attr('refX', 25)
      .attr('refY', 0)
      .attr('markerWidth', 6)
      .attr('markerHeight', 6)
      .attr('orient', 'auto')
      .append('path')
      .attr('d', 'M0,-5L10,0L0,5')
      .attr('fill', primaryColor);

    // Create a container group for pan/zoom
    const g = svg.append('g');

    // Add zoom behavior
    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 8])
      .on('zoom', (event) => {
        g.attr('transform', event.transform);
        // Update text visibility based on zoom level
        const scale = event.transform.k;
        updateTextVisibility(scale);
      });

    svg.call(zoom);

    // Create force simulation
    const simulation = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
        .id(d => d.id)
        .distance(150))
      .force('charge', d3.forceManyBody().strength(-500))
      .force('center', d3.forceCenter(width / 2, height / 2))
      .force('collision', d3.forceCollide().radius(50));

    // Create links
    const link = g.append('g')
      .selectAll('g')
      .data(links)
      .join('g');

    link.append('line')
      .attr('stroke', primaryColor)
      .attr('stroke-opacity', 0.6)
      .attr('stroke-width', d => Math.sqrt(d.callCount))
      .attr('marker-end', 'url(#arrow)');

    // Add call count labels on links
    const linkLabels = link.append('text')
      .attr('font-size', 10)
      .attr('fill', mutedForegroundColor)
      .attr('text-anchor', 'middle')
      .text(d => d.callCount);

    // Create nodes
    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .call(d3.drag<SVGGElement, GraphNode>()
        .on('start', dragstarted)
        .on('drag', dragged)
        .on('end', dragended) as any);

    // Node circles
    node.append('circle')
      .attr('r', d => Math.sqrt(d.eventCount) * 2 + 10)
      .attr('fill', primaryColor)
      .attr('stroke', borderColor)
      .attr('stroke-width', 2);

    // Background for labels to ensure readability
    const labelBg = node.append('rect')
      .attr('class', 'label-bg')
      .attr('x', d => -(d.id.length * 3.5))
      .attr('y', -8)
      .attr('width', d => d.id.length * 7)
      .attr('height', 16)
      .attr('fill', backgroundColor)
      .attr('opacity', 0.9)
      .attr('rx', 2);

    // Node labels - full text
    const nodeLabels = node.append('text')
      .attr('class', 'node-label')
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('font-size', 11)
      .attr('fill', foregroundColor)
      .attr('font-weight', 500)
      .attr('pointer-events', 'none')
      .text(d => d.id);

    // Node event count badges
    const eventCounts = node.append('text')
      .attr('class', 'event-count')
      .attr('text-anchor', 'middle')
      .attr('dy', '2.2em')
      .attr('font-size', 9)
      .attr('fill', mutedForegroundColor)
      .attr('pointer-events', 'none')
      .text(d => `${d.eventCount} events`);

    // Add tooltips
    node.append('title')
      .text(d => `${d.id}\n${d.eventCount} events`);

    link.append('title')
      .text(d => {
        const source = typeof d.source === 'object' ? d.source.id : d.source;
        const target = typeof d.target === 'object' ? d.target.id : d.target;
        return `${source} → ${target}\n${d.callCount} calls`;
      });

    // Function to update text visibility and truncation based on zoom
    function updateTextVisibility(scale: number) {
      // Show full text when zoomed in (scale > 1)
      nodeLabels.text(d => {
        if (scale > 1.5) {
          return d.id; // Show full text
        } else if (scale > 0.8) {
          return d.id.length > 12 ? d.id.substring(0, 10) + '...' : d.id;
        } else if (scale > 0.4) {
          return d.id.length > 8 ? d.id.substring(0, 6) + '...' : d.id;
        } else {
          return ''; // Hide text when zoomed out
        }
      });

      // Update label background width based on text
      labelBg.attr('width', function(d) {
        const textNode = this.parentNode?.querySelector('.node-label') as SVGTextElement;
        if (!textNode) return 0;
        const textLength = textNode.getComputedTextLength();
        return textLength + 8;
      }).attr('x', function(d) {
        const textNode = this.parentNode?.querySelector('.node-label') as SVGTextElement;
        if (!textNode) return 0;
        const textLength = textNode.getComputedTextLength();
        return -(textLength + 8) / 2;
      });

      // Show/hide event counts based on zoom
      eventCounts.style('opacity', scale > 0.8 ? 1 : 0);

      // Show/hide link labels based on zoom
      linkLabels.style('opacity', scale > 1 ? 1 : 0);
    }

    // Initial text visibility
    updateTextVisibility(1);

    // Update positions on each tick
    simulation.on('tick', () => {
      link.selectAll('line')
        .attr('x1', d => (d.source as GraphNode).x!)
        .attr('y1', d => (d.source as GraphNode).y!)
        .attr('x2', d => (d.target as GraphNode).x!)
        .attr('y2', d => (d.target as GraphNode).y!);

      linkLabels
        .attr('x', d => ((d.source as GraphNode).x! + (d.target as GraphNode).x!) / 2)
        .attr('y', d => ((d.source as GraphNode).y! + (d.target as GraphNode).y!) / 2);

      node
        .attr('transform', d => `translate(${d.x},${d.y})`);
    });

    // Drag functions
    function dragstarted(event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>) {
      if (!event.active) simulation.alphaTarget(0.3).restart();
      event.subject.fx = event.subject.x;
      event.subject.fy = event.subject.y;
    }

    function dragged(event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>) {
      event.subject.fx = event.x;
      event.subject.fy = event.y;
    }

    function dragended(event: d3.D3DragEvent<SVGGElement, GraphNode, GraphNode>) {
      if (!event.active) simulation.alphaTarget(0);
      event.subject.fx = null;
      event.subject.fy = null;
    }

    // Cleanup
    return () => {
      simulation.stop();
    };
  }, [data]);

  if (data.services.length === 0) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground">
        No services to visualize
      </div>
    );
  }

  return (
    <div className="w-full overflow-x-auto bg-card/50 rounded-lg border p-4">
      <svg ref={svgRef} className="mx-auto" />
    </div>
  );
}
