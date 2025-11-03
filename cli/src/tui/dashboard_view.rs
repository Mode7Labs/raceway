use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph},
    Frame,
};

use super::types::{GlobalAnalysisData, TraceMetadata};

/// Render the system dashboard with overview statistics
pub fn render_dashboard_view(
    f: &mut Frame,
    area: Rect,
    total_traces: usize,
    total_events: usize,
    total_services: usize,
    recent_traces: &[TraceMetadata],
    global_analysis: Option<&GlobalAnalysisData>,
) {
    // Split into main sections: stats (top), content (middle), footer (bottom)
    let main_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(5),  // Stats overview
            Constraint::Min(10),    // Main content area
        ])
        .split(area);

    // Render stats overview
    render_stats_overview(
        f,
        main_chunks[0],
        total_traces,
        total_events,
        total_services,
        global_analysis,
    );

    // Split content area into left (races) and right (hotspots + recent traces)
    let content_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([
            Constraint::Percentage(50),
            Constraint::Percentage(50),
        ])
        .split(main_chunks[1]);

    // Render races on left
    render_recent_races(f, content_chunks[0], global_analysis);

    // Split right side into hotspots (top) and traces (bottom)
    let right_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Percentage(50),
            Constraint::Percentage(50),
        ])
        .split(content_chunks[1]);

    // Render hotspots
    render_hotspots(f, right_chunks[0], global_analysis);

    // Render recent traces
    render_recent_traces(f, right_chunks[1], recent_traces);
}

fn render_stats_overview(
    f: &mut Frame,
    area: Rect,
    total_traces: usize,
    total_events: usize,
    total_services: usize,
    global_analysis: Option<&GlobalAnalysisData>,
) {
    let (total_races, concurrent_events) = if let Some(analysis) = global_analysis {
        (analysis.potential_races, analysis.concurrent_events)
    } else {
        (0, 0)
    };

    let stats = vec![
        Line::from(vec![
            Span::styled("📊 ", Style::default()),
            Span::styled(
                "System Overview",
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(""),
        Line::from(vec![
            Span::styled("Traces: ", Style::default().fg(Color::Yellow)),
            Span::styled(
                format!("{}", total_traces),
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("   "),
            Span::styled("Events: ", Style::default().fg(Color::Yellow)),
            Span::styled(
                format!("{}", total_events),
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("   "),
            Span::styled("Services: ", Style::default().fg(Color::Yellow)),
            Span::styled(
                format!("{}", total_services),
                Style::default()
                    .fg(Color::Green)
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("   "),
            Span::styled("Races: ", Style::default().fg(Color::Yellow)),
            Span::styled(
                format!("{}", total_races),
                Style::default()
                    .fg(if total_races > 0 { Color::Red } else { Color::Green })
                    .add_modifier(Modifier::BOLD),
            ),
            Span::raw("   "),
            Span::styled("Concurrent: ", Style::default().fg(Color::Yellow)),
            Span::styled(
                format!("{}", concurrent_events),
                Style::default()
                    .fg(Color::Cyan)
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
    ];

    let block = Block::default().borders(Borders::ALL).border_style(
        Style::default()
            .fg(Color::Magenta)
            .add_modifier(Modifier::BOLD),
    );

    let paragraph = Paragraph::new(stats).block(block);
    f.render_widget(paragraph, area);
}

fn render_recent_races(
    f: &mut Frame,
    area: Rect,
    global_analysis: Option<&GlobalAnalysisData>,
) {
    let items: Vec<ListItem> = if let Some(analysis) = global_analysis {
        if let Some(race_details) = &analysis.race_details {
            race_details
                .iter()
                .take(area.height.saturating_sub(2) as usize)
                .map(|race| {
                    let severity_color = match race.severity.as_str() {
                        "Critical" => Color::Red,
                        "Warning" => Color::Yellow,
                        _ => Color::Gray,
                    };

                    let severity_icon = match race.severity.as_str() {
                        "Critical" => "🔴",
                        "Warning" => "⚠️ ",
                        _ => "ℹ️ ",
                    };

                    // Format: [SEVERITY] variable @ service1 <-> service2
                    let trace1_short = &race.trace1_id[..8.min(race.trace1_id.len())];
                    let trace2_short = &race.trace2_id[..8.min(race.trace2_id.len())];

                    let text = format!(
                        "{} {} | {} ↔ {}",
                        severity_icon,
                        race.variable,
                        trace1_short,
                        trace2_short
                    );

                    ListItem::new(text).style(Style::default().fg(severity_color))
                })
                .collect()
        } else {
            vec![ListItem::new("No race details available")]
        }
    } else {
        vec![ListItem::new("Loading race data...")]
    };

    let title = format!(
        "⚠️  Recent Races ({})",
        global_analysis
            .map(|a| a.potential_races)
            .unwrap_or(0)
    );

    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(Style::default().fg(Color::Red));

    let list = List::new(items).block(block);
    f.render_widget(list, area);
}

fn render_hotspots(f: &mut Frame, area: Rect, global_analysis: Option<&GlobalAnalysisData>) {
    let items: Vec<ListItem> = if let Some(analysis) = global_analysis {
        if let Some(race_details) = &analysis.race_details {
            // Count variable accesses to find hotspots
            let mut variable_counts: std::collections::HashMap<String, usize> =
                std::collections::HashMap::new();

            for race in race_details {
                *variable_counts.entry(race.variable.clone()).or_insert(0) += 1;
            }

            // Sort by count and take top entries
            let mut sorted_vars: Vec<_> = variable_counts.into_iter().collect();
            sorted_vars.sort_by(|a, b| b.1.cmp(&a.1));

            sorted_vars
                .into_iter()
                .take(area.height.saturating_sub(2) as usize)
                .map(|(var, count)| {
                    let bar_length = (count * 10).min(20);
                    let bar = "█".repeat(bar_length);

                    let text = format!("{:20} {} {}", var, bar, count);

                    let color = if count > 5 {
                        Color::Red
                    } else if count > 2 {
                        Color::Yellow
                    } else {
                        Color::Green
                    };

                    ListItem::new(text).style(Style::default().fg(color))
                })
                .collect()
        } else {
            vec![ListItem::new("No hotspot data available")]
        }
    } else {
        vec![ListItem::new("Loading hotspot data...")]
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title("🔥 Variable Hotspots")
        .border_style(Style::default().fg(Color::Yellow));

    let list = List::new(items).block(block);
    f.render_widget(list, area);
}

fn render_recent_traces(f: &mut Frame, area: Rect, recent_traces: &[TraceMetadata]) {
    let items: Vec<ListItem> = recent_traces
        .iter()
        .take(area.height.saturating_sub(2) as usize)
        .map(|trace| {
            let trace_id_short = &trace.trace_id[..8.min(trace.trace_id.len())];
            let time = &trace.last_timestamp[11..19.min(trace.last_timestamp.len())];

            let text = format!(
                "{} | {} events | {} services | {}",
                trace_id_short, trace.event_count, trace.service_count, time
            );

            ListItem::new(text)
        })
        .collect();

    let title = format!("📋 Recent Traces ({})", recent_traces.len());

    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(Style::default().fg(Color::Cyan));

    let list = List::new(items).block(block);
    f.render_widget(list, area);
}
