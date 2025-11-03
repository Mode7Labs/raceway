import { useEffect, useRef } from 'react';
import * as d3 from 'd3';
import { type Event } from '@/types';
import { getEventKindBackgroundColor } from '@/lib/event-colors';

interface EventTypeChartProps {
  events: Event[];
}

export function EventTypeChart({ events }: EventTypeChartProps) {
  const svgRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    if (!svgRef.current || events.length === 0) return;

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

    // Count event types
    const eventTypeCounts = events.reduce((acc, event) => {
      const kind = typeof event.kind === 'string'
        ? event.kind
        : Object.keys(event.kind)[0] || 'Unknown';
      acc[kind] = (acc[kind] || 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    // Convert to array and sort by count
    const data = Object.entries(eventTypeCounts)
      .map(([kind, count]) => ({ kind, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8); // Top 8 event types

    const width = 300;
    const height = 300;
    const radius = Math.min(width, height) / 2;

    const svg = d3.select(svgRef.current)
      .attr('width', width)
      .attr('height', height)
      .attr('viewBox', [0, 0, width, height])
      .attr('style', 'max-width: 100%; height: auto;');

    const g = svg.append('g')
      .attr('transform', `translate(${width / 2}, ${height / 2})`);

    // Create pie layout
    const pie = d3.pie<{ kind: string; count: number }>()
      .value(d => d.count)
      .sort(null);

    // Create arc generator
    const arc = d3.arc<d3.PieArcDatum<{ kind: string; count: number }>>()
      .innerRadius(radius * 0.5) // Donut hole
      .outerRadius(radius * 0.8);

    const labelArc = d3.arc<d3.PieArcDatum<{ kind: string; count: number }>>()
      .innerRadius(radius * 0.85)
      .outerRadius(radius * 0.85);

    // Create arcs
    const arcs = g.selectAll('.arc')
      .data(pie(data))
      .join('g')
      .attr('class', 'arc');

    arcs.append('path')
      .attr('d', arc)
      .attr('fill', d => getEventKindBackgroundColor(d.data.kind))
      .attr('stroke', backgroundColor)
      .attr('stroke-width', 2)
      .style('cursor', 'pointer')
      .on('mouseover', function() {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('d', d3.arc<d3.PieArcDatum<{ kind: string; count: number }>>()
            .innerRadius(radius * 0.5)
            .outerRadius(radius * 0.85) as any
          );
      })
      .on('mouseout', function() {
        d3.select(this)
          .transition()
          .duration(200)
          .attr('d', arc as any);
      });

    // Add percentage labels
    arcs.append('text')
      .attr('transform', d => `translate(${labelArc.centroid(d)})`)
      .attr('text-anchor', 'middle')
      .attr('font-size', 10)
      .attr('font-weight', 500)
      .attr('fill', foregroundColor)
      .attr('pointer-events', 'none')
      .text(d => {
        const percentage = (d.data.count / events.length) * 100;
        return percentage > 5 ? `${percentage.toFixed(0)}%` : '';
      });

    // Add center label
    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('font-size', 24)
      .attr('font-weight', 600)
      .attr('fill', foregroundColor)
      .attr('dy', '-0.2em')
      .text(events.length);

    g.append('text')
      .attr('text-anchor', 'middle')
      .attr('font-size', 11)
      .attr('fill', mutedForegroundColor)
      .attr('dy', '1.2em')
      .text('Total Events');

  }, [events]);

  if (events.length === 0) {
    return null;
  }

  // Get event type data for legend
  const eventTypeCounts = events.reduce((acc, event) => {
    const kind = typeof event.kind === 'string'
      ? event.kind
      : Object.keys(event.kind)[0] || 'Unknown';
    acc[kind] = (acc[kind] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const legendData = Object.entries(eventTypeCounts)
    .map(([kind, count]) => ({ kind, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  return (
    <div className="flex flex-col items-center gap-4">
      <svg ref={svgRef} className="mx-auto" />
      <div className="grid grid-cols-2 gap-2 w-full max-w-sm text-xs">
        {legendData.map(({ kind, count }) => {
          const percentage = ((count / events.length) * 100).toFixed(1);
          return (
            <div key={kind} className="flex items-center gap-2">
              <div
                className="w-3 h-3 rounded-sm flex-shrink-0"
                style={{ backgroundColor: getEventKindBackgroundColor(kind) }}
              />
              <span className="truncate flex-1">{kind}</span>
              <span className="text-muted-foreground">{percentage}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
