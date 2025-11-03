# Terminal UI (TUI)

Keyboard-driven terminal interface for analyzing traces without leaving your terminal.

## Overview

Raceway TUI is a powerful terminal user interface built with Ratatui, offering:
- Real-time trace monitoring
- Keyboard-driven navigation (Vim-style)
- Multiple analysis views
- Fast performance (native Rust)
- Works over SSH

## Starting the TUI

```bash
# Start TUI (connects to local server)
cargo run --release -- tui

# Connect to remote server
cargo run --release -- tui --server http://remote:8080

# With API key
export RACEWAY_API_KEY=your-key
cargo run --release -- tui
```

## Interface Layout

```
┌─────────────────────────────────────────────┐
│ Raceway TUI    [Connected] Auto: ON        │  Status Bar
├────────────┬────────────────────────────────┤
│  Traces    │  Event View                    │  Main Area
│            │                                │
│  > trace-1 │  #  Time    Kind     Location  │
│    trace-2 │  1  10:30   HTTP     api.ts:42 │
│    trace-3 │  2  10:31   Query    db.ts:15  │
│            │  3  10:31   Write    api.ts:45 │
├────────────┴────────────────────────────────┤
│ [Tab] Views │ [Enter] Details │ [q] Quit   │  Help Bar
└─────────────────────────────────────────────┘
```

## Keyboard Shortcuts

### Navigation

| Key | Action |
|-----|--------|
| `j` / `↓` | Move down |
| `k` / `↑` | Move up |
| `g` | Go to top |
| `G` | Go to bottom |
| `Enter` | Select/view details |
| `Esc` | Back/cancel |

### Views

| Key | Action |
|-----|--------|
| `Tab` | Next view |
| `Shift+Tab` | Previous view |
| `1-6` | Jump to view |

### Actions

| Key | Action |
|-----|--------|
| `r` | Refresh |
| `a` | Toggle auto-refresh |
| `/` | Search |
| `n` | Next search result |
| `N` | Previous search result |
| `q` | Quit |

## Views

### 1. Events View

List of all events in the trace:
- Event ID
- Timestamp
- Kind
- Duration
- Location
- Vector clock

**Features:**
- Syntax highlighting
- Race highlighting
- Scroll with j/k
- View details with Enter

### 2. Tree View

Hierarchical view of event relationships:
- Parent-child structure
- Indent levels
- Expand/collapse with Enter
- Visual tree lines

### 3. Critical Path View

Events on the critical path:
- Path events highlighted
- Duration totals
- Percentage of trace
- Optimization hints

### 4. Anomalies View

Performance anomalies and race conditions:
- Severity indicators
- Expected vs actual duration
- Variable names for races
- Source locations

### 5. Dependencies View

Service dependency graph:
- Service list
- Call relationships
- Latency statistics
- Service health

### 6. Audit Trail View

Variable access history:
- Prompt for variable name
- Chronological access list
- Read/Write indicators
- Thread information

## Auto-Refresh

**Toggle:** Press `a`

When enabled:
- Fetches latest traces every 5 seconds
- Updates current view
- Shows "Auto: ON" in status bar

When disabled:
- Manual refresh with `r`
- Shows "Auto: OFF"

## Search

1. Press `/` to enter search mode
2. Type query
3. Press Enter to search
4. Use `n`/`N` to navigate results
5. Press Esc to clear

**Searches:**
- Event IDs
- Event kinds
- Locations
- Any event content

## Color Scheme

**Events:**
- Blue: HTTP requests
- Green: Database queries
- Yellow: State changes
- Red: Errors
- Orange: Race conditions

**Status:**
- Green: Connected
- Red: Disconnected
- Yellow: Connecting

**Severity:**
- Red: Critical races
- Orange: Warnings
- Yellow: Anomalies

## Performance

**Optimized for:**
- 100,000+ events
- Low memory usage
- Fast rendering
- Minimal CPU

**Hardware requirements:**
- Any terminal emulator
- Works over slow SSH
- Minimal bandwidth

## Terminal Compatibility

**Tested with:**
- iTerm2 (macOS)
- Alacritty
- Windows Terminal
- GNOME Terminal
- tmux/screen

**Requirements:**
- 256 colors support
- Unicode support
- Minimum 80x24 size

## Tips

### Efficient Workflow

1. **Keep TUI open** - Run in tmux/screen
2. **Use auto-refresh** - Monitor in real-time
3. **Jump to views** - Use number keys (1-6)
4. **Search quickly** - / for instant search

### Remote Monitoring

```bash
# On server
tmux new -s raceway
cargo run --release -- tui

# Detach: Ctrl+b, d
# Reattach: tmux attach -t raceway
```

### Multiple Traces

- Use j/k to quickly scan trace list
- Press Enter to view
- Press Esc to go back
- Use search (/) to find specific traces

## Limitations

- No mouse support (keyboard only)
- No graphs (use Web UI for visualizations)
- Limited to terminal width
- No color customization

## Next Steps

- [Web UI](/guide/web-ui) - Graphical interface
- [HTTP API](/guide/http-api) - Programmatic access
- [Getting Started](/guide/getting-started) - Setup guide
