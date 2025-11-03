use crate::tui::types::AnomaliesData;
use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, List, ListItem, Paragraph},
    Frame,
};

fn severity_color(severity: &str) -> Color {
    match severity {
        "Critical" => Color::Red,
        "Warning" => Color::Yellow,
        "Minor" => Color::Blue,
        _ => Color::White,
    }
}

fn severity_icon(severity: &str) -> &'static str {
    match severity {
        "Critical" => "🚨",
        "Warning" => "⚠️ ",
        "Minor" => "ℹ️ ",
        _ => "•",
    }
}

pub fn render_anomalies_list(
    f: &mut Frame,
    area: Rect,
    anomalies: &Option<AnomaliesData>,
    focused: bool,
    selected_index: usize,
) {
    let title = if focused {
        "🔍 Anomalies [j/k] ●"
    } else {
        "🔍 Anomalies [j/k]"
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(if focused {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default()
        });

    if let Some(data) = anomalies {
        if data.anomaly_count == 0 {
            let widget = Paragraph::new("✅ No anomalies detected")
                .block(block)
                .style(Style::default().fg(Color::Green));
            f.render_widget(widget, area);
            return;
        }

        let items: Vec<ListItem> = data
            .anomalies
            .iter()
            .enumerate()
            .map(|(i, anomaly)| {
                let is_selected = i == selected_index;
                let icon = severity_icon(&anomaly.severity);
                let text = format!(
                    "{} {} {:.2}ms (exp: {:.2}ms) - {:.1}σ",
                    icon,
                    anomaly.event_kind,
                    anomaly.actual_duration_ms,
                    anomaly.expected_duration_ms,
                    anomaly.std_dev_from_mean
                );

                let color = severity_color(&anomaly.severity);
                let style = if is_selected {
                    Style::default()
                        .fg(color)
                        .add_modifier(Modifier::BOLD | Modifier::REVERSED)
                } else {
                    Style::default().fg(color)
                };

                ListItem::new(text).style(style)
            })
            .collect();

        let widget = List::new(items).block(block);
        f.render_widget(widget, area);
    } else {
        let widget = Paragraph::new("No anomaly data available")
            .block(block)
            .style(Style::default().fg(Color::DarkGray));
        f.render_widget(widget, area);
    }
}
