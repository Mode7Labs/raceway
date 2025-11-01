use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph, Wrap},
    Frame,
};
use std::collections::HashSet;

/// Render the time-travel debugger view with playback controls
pub fn render_debugger_view(
    f: &mut Frame,
    area: Rect,
    event_data: &[serde_json::Value],
    events_in_races: &HashSet<String>,
    focused: bool,
    current_index: usize,
    is_playing: bool,
    playback_speed: f64,
) {
    // Split area into: controls (3 lines), timeline (40%), state (60%)
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),  // Controls
            Constraint::Percentage(40), // Timeline/events
            Constraint::Percentage(60), // State snapshot
        ])
        .split(area);

    // Render controls
    render_debugger_controls(f, chunks[0], current_index, event_data.len(), is_playing, playback_speed);

    // Render timeline
    render_debugger_timeline(f, chunks[1], event_data, events_in_races, focused, current_index);

    // Render state snapshot
    render_state_snapshot(f, chunks[2], event_data, current_index);
}

fn render_debugger_controls(
    f: &mut Frame,
    area: Rect,
    current_index: usize,
    total_events: usize,
    is_playing: bool,
    playback_speed: f64,
) {
    let progress_pct = if total_events > 0 {
        (current_index as f64 / (total_events - 1).max(1) as f64 * 100.0) as usize
    } else {
        0
    };

    let play_icon = if is_playing { "▶" } else { "⏸" };
    let speed_label = match playback_speed as usize {
        1 => "1x",
        2 => "2x",
        4 => "4x",
        _ => "0.5x",
    };

    let controls = Line::from(vec![
        Span::styled(
            format!("{} {}/{} ", play_icon, current_index + 1, total_events),
            Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD),
        ),
        Span::raw("│ "),
        Span::styled(
            format!("{}% ", progress_pct),
            Style::default().fg(Color::Yellow),
        ),
        Span::raw("│ "),
        Span::styled(
            format!("Speed: {} ", speed_label),
            Style::default().fg(Color::Green),
        ),
        Span::raw("│ "),
        Span::raw("Space:Play  "),
        Span::styled("←/→", Style::default().fg(Color::Cyan)),
        Span::raw(":Step  "),
        Span::styled("Home/End", Style::default().fg(Color::Cyan)),
        Span::raw(":Jump  "),
        Span::styled("[/]", Style::default().fg(Color::Cyan)),
        Span::raw(":Speed"),
    ]);

    let block = Block::default()
        .borders(Borders::ALL)
        .title("⏯ Debugger Controls")
        .border_style(Style::default().fg(Color::Magenta));

    let paragraph = Paragraph::new(controls).block(block);
    f.render_widget(paragraph, area);
}

fn render_debugger_timeline(
    f: &mut Frame,
    area: Rect,
    event_data: &[serde_json::Value],
    events_in_races: &HashSet<String>,
    focused: bool,
    current_index: usize,
) {
    // Show events around current index (context window)
    let window_size = area.height.saturating_sub(2) as usize; // Account for borders
    let half_window = window_size / 2;

    let start_idx = current_index.saturating_sub(half_window);
    let end_idx = (current_index + half_window).min(event_data.len());

    let items: Vec<ListItem> = event_data[start_idx..end_idx]
        .iter()
        .enumerate()
        .map(|(offset, event)| {
            let idx = start_idx + offset;
            let is_current = idx == current_index;

            // Get event info
            let kind = event
                .get("kind")
                .and_then(|k| {
                    if let Some(obj) = k.as_object() {
                        obj.keys().next().map(|s| s.as_str())
                    } else {
                        None
                    }
                })
                .unwrap_or("Unknown");

            let timestamp = event
                .get("timestamp")
                .and_then(|t| t.as_str())
                .unwrap_or("?");

            // Check if event is in a race
            let event_in_race = event
                .get("id")
                .and_then(|id| id.as_str())
                .map(|id_str| {
                    let event_id_short = &id_str[..8.min(id_str.len())];
                    events_in_races.contains(event_id_short)
                })
                .unwrap_or(false);

            // Service badge
            let service_badge = event
                .get("metadata")
                .and_then(|m| m.get("service_name"))
                .and_then(|s| s.as_str())
                .map(|service| {
                    let short = if service.len() > 10 {
                        &service[..10]
                    } else {
                        service
                    };
                    format!("[{}] ", short)
                })
                .unwrap_or_default();

            let marker = if is_current { "▶" } else { " " };

            let text = format!(
                "{} {}. {} {}{}",
                marker,
                idx + 1,
                &timestamp[11..19.min(timestamp.len())],
                service_badge,
                kind
            );

            let style = if is_current {
                if event_in_race {
                    Style::default()
                        .fg(Color::Red)
                        .add_modifier(Modifier::BOLD | Modifier::REVERSED)
                } else {
                    Style::default()
                        .fg(Color::Green)
                        .add_modifier(Modifier::BOLD | Modifier::REVERSED)
                }
            } else if event_in_race {
                Style::default().fg(Color::Red)
            } else {
                Style::default()
            };

            ListItem::new(text).style(style)
        })
        .collect();

    let title = if focused {
        "⏱ Timeline [j/k to step] ●"
    } else {
        "⏱ Timeline [j/k to step]"
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(if focused {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default()
        });

    let list = List::new(items).block(block);
    f.render_widget(list, area);
}

fn render_state_snapshot(
    f: &mut Frame,
    area: Rect,
    event_data: &[serde_json::Value],
    current_index: usize,
) {
    if current_index >= event_data.len() {
        let block = Block::default()
            .borders(Borders::ALL)
            .title("📊 State Snapshot");
        let paragraph = Paragraph::new("No event selected").block(block);
        f.render_widget(paragraph, area);
        return;
    }

    let event = &event_data[current_index];

    // Build state snapshot from events up to current index
    let mut state_lines = vec![
        Line::from(vec![
            Span::styled(
                "Current State ",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::styled(
                format!("(after {} events)", current_index + 1),
                Style::default().fg(Color::DarkGray),
            ),
        ]),
        Line::from(""),
    ];

    // Show current event details
    if let Some(kind_obj) = event.get("kind").and_then(|k| k.as_object()) {
        for (kind_name, kind_data) in kind_obj {
            state_lines.push(Line::from(vec![
                Span::styled("Event: ", Style::default().fg(Color::Yellow)),
                Span::raw(kind_name),
            ]));

            // Show StateChange details
            if kind_name == "StateChange" {
                if let Some(var) = kind_data.get("variable").and_then(|v| v.as_str()) {
                    state_lines.push(Line::from(vec![
                        Span::styled("  Variable: ", Style::default().fg(Color::Yellow)),
                        Span::styled(var, Style::default().fg(Color::Green)),
                    ]));
                }
                if let Some(old) = kind_data.get("old_value") {
                    state_lines.push(Line::from(vec![
                        Span::styled("  Old: ", Style::default().fg(Color::Yellow)),
                        Span::raw(format!("{}", old)),
                    ]));
                }
                if let Some(new) = kind_data.get("new_value") {
                    state_lines.push(Line::from(vec![
                        Span::styled("  New: ", Style::default().fg(Color::Yellow)),
                        Span::styled(
                            format!("{}", new),
                            Style::default().fg(Color::Green).add_modifier(Modifier::BOLD),
                        ),
                    ]));
                }
                if let Some(loc) = kind_data.get("location").and_then(|l| l.as_str()) {
                    state_lines.push(Line::from(vec![
                        Span::styled("  Location: ", Style::default().fg(Color::Yellow)),
                        Span::raw(loc),
                    ]));
                }
            }
            // Show FunctionCall details
            else if kind_name == "FunctionCall" {
                if let Some(func) = kind_data.get("function_name").and_then(|f| f.as_str()) {
                    state_lines.push(Line::from(vec![
                        Span::styled("  Function: ", Style::default().fg(Color::Yellow)),
                        Span::styled(func, Style::default().fg(Color::Cyan)),
                    ]));
                }
                if let Some(args) = kind_data.get("args") {
                    state_lines.push(Line::from(vec![
                        Span::styled("  Args: ", Style::default().fg(Color::Yellow)),
                        Span::raw(format!("{}", args)),
                    ]));
                }
            }
            // Show HTTPRequest details
            else if kind_name == "HTTPRequest" {
                if let Some(method) = kind_data.get("method").and_then(|m| m.as_str()) {
                    if let Some(url) = kind_data.get("url").and_then(|u| u.as_str()) {
                        state_lines.push(Line::from(vec![
                            Span::styled("  ", Style::default()),
                            Span::styled(method, Style::default().fg(Color::Blue).add_modifier(Modifier::BOLD)),
                            Span::raw(" "),
                            Span::raw(url),
                        ]));
                    }
                }
            }
            // Show HTTPResponse details
            else if kind_name == "HTTPResponse" {
                if let Some(status) = kind_data.get("status_code").and_then(|s| s.as_i64()) {
                    let status_color = if status >= 200 && status < 300 {
                        Color::Green
                    } else if status >= 400 {
                        Color::Red
                    } else {
                        Color::Yellow
                    };

                    state_lines.push(Line::from(vec![
                        Span::styled("  Status: ", Style::default().fg(Color::Yellow)),
                        Span::styled(
                            format!("{}", status),
                            Style::default().fg(status_color).add_modifier(Modifier::BOLD),
                        ),
                    ]));
                }
                if let Some(duration) = kind_data.get("duration_ms").and_then(|d| d.as_f64()) {
                    state_lines.push(Line::from(vec![
                        Span::styled("  Duration: ", Style::default().fg(Color::Yellow)),
                        Span::raw(format!("{:.2}ms", duration)),
                    ]));
                }
            }
        }
    }

    // Show metadata
    state_lines.push(Line::from(""));
    state_lines.push(Line::from(vec![
        Span::styled(
            "Metadata",
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::BOLD),
        ),
    ]));

    if let Some(metadata) = event.get("metadata") {
        if let Some(service) = metadata.get("service_name").and_then(|s| s.as_str()) {
            state_lines.push(Line::from(vec![
                Span::styled("  Service: ", Style::default().fg(Color::Yellow)),
                Span::raw(service),
            ]));
        }
        if let Some(instance) = metadata.get("instance_id").and_then(|i| i.as_str()) {
            state_lines.push(Line::from(vec![
                Span::styled("  Instance: ", Style::default().fg(Color::Yellow)),
                Span::raw(&instance[..8.min(instance.len())]),
            ]));
        }
    }

    // Show vector clock
    if let Some(vc) = event.get("vector_clock") {
        state_lines.push(Line::from(""));
        state_lines.push(Line::from(vec![
            Span::styled(
                "Vector Clock",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
        ]));
        state_lines.push(Line::from(vec![
            Span::styled("  ", Style::default()),
            Span::styled(
                format!("{}", vc),
                Style::default().fg(Color::DarkGray),
            ),
        ]));
    }

    let block = Block::default()
        .borders(Borders::ALL)
        .title("📊 State Snapshot [u/d to scroll]");

    let paragraph = Paragraph::new(state_lines)
        .block(block)
        .wrap(Wrap { trim: true });

    f.render_widget(paragraph, area);
}
