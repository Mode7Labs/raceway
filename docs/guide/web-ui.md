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

::: warning Node.js Required
The Web UI is a React application that **must be built** before the server can serve it. You need **Node.js 18+** to build the UI.
:::

### Server Integration (Recommended)

**By default, the Raceway server serves the Web UI on the root path** (`/`) after it's been built:

```bash
# 1. Build the Web UI
cd web
npm install
npm run build
cd ..

# 2. Start the Raceway server (serves UI on /)
cargo run --release -- serve
```

**Access:** `http://localhost:8080/` (Web UI on root, API on `/api/*`)

The server will serve the built UI from `web/dist/` automatically. If the UI hasn't been built, the root path will return a 404.

### Development Mode (Optional)

For active UI development, run the UI with hot-reload in a separate terminal:

```bash
# Terminal 1: Start the Raceway server
cargo run -- serve

# Terminal 2: Start the Web UI dev server
cd web
npm run dev
```

**Access:** `http://localhost:3005` (Vite dev server with hot reload)

::: tip Quick Build Script
Use the provided build script to build both UI and server:
```bash
bash scripts/build-with-ui.sh
```
This builds the Web UI first, then compiles the Rust server with the embedded UI.
:::

### Production Deployment

For production, you have two options:

**Option 1: Embedded (Recommended)**
Build the UI and let the Raceway server serve it:
```bash
cd web && npm run build && cd ..
cargo build --release
./target/release/raceway serve
```
The server serves the UI on `/` and API on `/api/*`.

**Option 2: Separate Web Server**
Serve `web/dist/` with nginx or Caddy and proxy API requests:
```nginx
server {
    listen 80;
    root /path/to/raceway/web/dist;

    location /api {
        proxy_pass http://localhost:8080;
    }
}
```

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
