# Web UI

Modern React-based interface for visualizing and analyzing traces.

## Overview

The Raceway Web UI provides a comprehensive interface for:
- Browsing traces
- Visualizing events in multiple formats
- Analyzing critical paths and anomalies
- Detecting race conditions
- Viewing service dependencies
- Tracking variable access

## Setup

The Web UI is a separate React application that must be run alongside the Raceway server:

```bash
# Terminal 1: Start the Raceway server
cargo run -- serve

# Terminal 2: Start the Web UI
cd web
npm install
npm run dev
```

**Access:** `http://localhost:3005` (Vite dev server)

::: tip Production Deployment
For production, build the UI (`npm run build`) and serve the `web/dist/` directory with your preferred web server (nginx, Caddy, etc.). The UI uses the `/api` proxy configuration to communicate with the Raceway server.
:::

## Key Features

### 1. Multiple Event Views

**List View:**
- Traditional event list
- Service badges
- Duration and timestamps
- Race condition highlighting
- Sortable and filterable

**Tree View:**
- Hierarchical parent-child relationships
- Expand/collapse nodes
- Visual indentation
- Causal dependencies

**Timeline View:**
- Time-based visualization
- Horizontal timeline
- Concurrent events shown in parallel
- Duration bars

**Causal Graph (DAG):**
- Directed acyclic graph
- Interactive force-directed layout
- Zoom and pan
- Critical path highlighting

**Lock Contention View:**
- Lock acquisition timeline
- Blocking relationships
- Contention visualization
- Thread activity

### 2. Critical Path Analysis

**List Mode:**
- Critical path events in order
- Durations highlighted
- Percentage of total time
- Source code locations

**Graph Mode:**
- DAG with critical path highlighted in red
- Non-critical events in gray
- Interactive exploration

**Insights:**
- Total path duration
- Percentage of trace time
- Event breakdown
- Optimization suggestions

### 3. Performance Analysis

**Performance Tab:**
- Critical path summary
- Service dependencies
- Duration statistics
- Event type distribution charts

### 4. Race Condition Detection

**Anomalies Tab:**
- List of detected races
- Severity indicators (Critical/Warning)
- Variable names
- Conflicting events
- Source locations

**Visual Indicators:**
- Red badges for critical races
- Orange for warnings
- Highlighted events in all views

### 5. Variable Audit Trails

**Variables Tab:**
- Select variable from list
- Complete access history
- Read/Write indicators
- Thread/service information
- Timeline of accesses
- Cross-trace links

### 6. Service Analytics

**Services View:**
- Service list with metrics
- Call counts
- Average latencies
- Error rates
- Dependency graphs

### 7. System Insights

**Dashboard:**
- Recent traces
- Global statistics
- Service health
- Race condition overview
- Performance hotspots

**Dependency Graph:**
- Service topology
- Call relationships
- Traffic flow
- Interactive filtering

## Navigation

### Main Layout

```
┌─────────────────────────────────────────┐
│  Logo  Raceway        Status  [Refresh] │  Header
├────────┬──────────────────────┬──────────┤
│ Traces │   Main Content       │ Details  │  Content
│  List  │   (Tabs & Views)     │  Panel   │
│        │                      │          │
│        │                      │          │
│        │                      │          │
└────────┴──────────────────────┴──────────┘
```

### Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `j/k` | Navigate traces up/down |
| `Enter` | Select trace |
| `r` | Refresh |
| `Tab` | Switch views |
| `/` | Focus search |
| `Esc` | Clear selection |

### Tabs

**Trace View:**
- Overview: Summary and statistics
- Debugger: Step-through causal debugger
- Events: Multiple event visualizations
- Performance: Critical path and dependencies
- Variables: Audit trails
- Anomalies: Races and performance issues

**System View:**
- Insights: Dashboard and analytics
- Dependency Graph: Service topology
- Performance: System-wide metrics
- Health: Service health status
- Hotspots: Performance hotspots
- Races: Global race conditions

## Theme

**Dark/Light Mode:**
- Toggle in top-right corner
- Persisted in browser
- Optimized for both modes

## Export

**Export Options:**
- JSON (trace data)
- CSV (events)
- PNG (graph visualizations)

**Button location:** Top-right when viewing a trace

## Filtering and Search

**Trace List:**
- Search by trace ID
- Filter by service
- Sort by time/duration

**Events:**
- Filter by event kind
- Search event content
- Filter by thread
- Show only critical path

**Services:**
- Filter by service name
- Sort by metrics
- Toggle visibility

## Performance

**Optimizations:**
- Virtualized lists for 10,000+ events
- Lazy loading of large traces
- Memoized components
- Efficient re-renders

**Best for:**
- Traces with <10,000 events (instant)
- Up to 50,000 events (smooth)
- >100,000 events (may be slow)

## Responsive Design

**Mobile Support:**
- Responsive layout
- Touch-friendly
- Optimized for tablets
- Simplified views on small screens

## Browser Compatibility

**Supported:**
- Chrome/Edge 90+
- Firefox 88+
- Safari 14+

**Features require:**
- JavaScript enabled
- Modern CSS support
- WebGL for graph rendering

## Next Steps

- [Terminal UI](/guide/tui) - Command-line interface
- [HTTP API](/guide/http-api) - Programmatic access
- [Getting Started](/guide/getting-started) - Basic setup
