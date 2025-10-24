use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Modifier, Style},
    text::{Line, Span},
    widgets::{Block, Borders, List, ListItem, Paragraph, Wrap},
    Frame,
};

use super::types::DistributedTraceAnalysisData;

pub fn render_distributed_analysis(
    f: &mut Frame,
    area: Rect,
    data: &DistributedTraceAnalysisData,
) {
    // Split the area into sections
    let chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([
            Constraint::Length(3),  // Header
            Constraint::Length(10), // Service breakdown
            Constraint::Length(6),  // Critical path summary
            Constraint::Length(5),  // Race conditions summary
            Constraint::Min(0),     // Spacer
        ])
        .split(area);

    // Render header
    let title = if data.is_distributed {
        format!(
            "🌐 Distributed Trace Analysis ({} services)",
            data.service_breakdown.total_services
        )
    } else {
        "📊 Single-Service Trace Analysis".to_string()
    };

    let header = Paragraph::new(title)
        .block(
            Block::default()
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Cyan)),
        )
        .style(Style::default().fg(Color::Cyan).add_modifier(Modifier::BOLD));

    f.render_widget(header, chunks[0]);

    // Render service breakdown
    render_service_breakdown(f, chunks[1], data);

    // Render critical path summary
    render_critical_path_summary(f, chunks[2], data);

    // Render race conditions summary
    render_race_conditions_summary(f, chunks[3], data);
}

fn render_service_breakdown(
    f: &mut Frame,
    area: Rect,
    data: &DistributedTraceAnalysisData,
) {
    let mut items = vec![];

    // Header
    items.push(ListItem::new(Line::from(vec![
        Span::styled(
            format!("{:<25}", "Service"),
            Style::default().add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("{:>10}", "Events"),
            Style::default().add_modifier(Modifier::BOLD),
        ),
        Span::styled(
            format!("{:>15}", "Duration (ms)"),
            Style::default().add_modifier(Modifier::BOLD),
        ),
    ])));

    items.push(ListItem::new("─".repeat(50)));

    // Services
    for service in &data.service_breakdown.services {
        let color = if service.total_duration_ms > 10.0 {
            Color::Red
        } else if service.total_duration_ms > 5.0 {
            Color::Yellow
        } else {
            Color::Green
        };

        items.push(ListItem::new(Line::from(vec![
            Span::raw(format!("{:<25}", service.name)),
            Span::raw(format!("{:>10}", service.event_count)),
            Span::styled(
                format!("{:>15.2}", service.total_duration_ms),
                Style::default().fg(color),
            ),
        ])));
    }

    // Cross-service calls
    if data.service_breakdown.cross_service_calls > 0 {
        items.push(ListItem::new(""));
        items.push(ListItem::new(Line::from(vec![Span::styled(
            format!(
                "Cross-service calls: {}",
                data.service_breakdown.cross_service_calls
            ),
            Style::default()
                .fg(Color::Cyan)
                .add_modifier(Modifier::ITALIC),
        )])));
    }

    let list = List::new(items).block(
        Block::default()
            .title("Service Breakdown")
            .borders(Borders::ALL)
            .border_style(Style::default().fg(Color::Green)),
    );

    f.render_widget(list, area);
}

fn render_critical_path_summary(
    f: &mut Frame,
    area: Rect,
    data: &DistributedTraceAnalysisData,
) {
    let content = if let Some(ref cp) = data.critical_path {
        vec![
            Line::from(vec![
                Span::raw("Total Duration: "),
                Span::styled(
                    format!("{:.2} ms", cp.total_duration_ms),
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD),
                ),
            ]),
            Line::from(vec![
                Span::raw("Trace Duration: "),
                Span::raw(format!("{:.2} ms", cp.trace_total_duration_ms)),
            ]),
            Line::from(vec![
                Span::raw("Path Events: "),
                Span::raw(cp.path_events.to_string()),
            ]),
            Line::from(vec![
                Span::raw("Percentage: "),
                Span::styled(
                    format!("{:.1}%", cp.percentage_of_total),
                    Style::default().fg(Color::Cyan),
                ),
            ]),
        ]
    } else {
        vec![Line::from("No critical path data available")]
    };

    let paragraph = Paragraph::new(content)
        .block(
            Block::default()
                .title("Critical Path")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(Color::Yellow)),
        )
        .wrap(Wrap { trim: true });

    f.render_widget(paragraph, area);
}

fn render_race_conditions_summary(
    f: &mut Frame,
    area: Rect,
    data: &DistributedTraceAnalysisData,
) {
    let rc = &data.race_conditions;

    let content = vec![
        Line::from(vec![
            Span::raw("Total Races: "),
            Span::styled(
                rc.total_races.to_string(),
                Style::default()
                    .fg(if rc.total_races > 0 {
                        Color::Red
                    } else {
                        Color::Green
                    })
                    .add_modifier(Modifier::BOLD),
            ),
        ]),
        Line::from(vec![
            Span::raw("  Critical: "),
            Span::styled(
                rc.critical_races.to_string(),
                Style::default().fg(Color::Red),
            ),
        ]),
        Line::from(vec![
            Span::raw("  Warning: "),
            Span::styled(
                rc.warning_races.to_string(),
                Style::default().fg(Color::Yellow),
            ),
        ]),
    ];

    let paragraph = Paragraph::new(content)
        .block(
            Block::default()
                .title("Race Conditions")
                .borders(Borders::ALL)
                .border_style(Style::default().fg(if rc.critical_races > 0 {
                    Color::Red
                } else if rc.warning_races > 0 {
                    Color::Yellow
                } else {
                    Color::Green
                })),
        )
        .wrap(Wrap { trim: true });

    f.render_widget(paragraph, area);
}
