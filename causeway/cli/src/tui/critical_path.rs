use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, List, ListItem, Paragraph, Wrap},
    Frame,
};
use crate::tui::types::CriticalPathData;

pub fn render_critical_path(
    f: &mut Frame,
    area: Rect,
    critical_path: &Option<CriticalPathData>,
    focused: bool,
) {
    let title = if focused {
        "🎯 Critical Path ●"
    } else {
        "🎯 Critical Path"
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(if focused {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default()
        });

    if let Some(path_data) = critical_path {
        // Create summary header
        let summary = format!(
            "Critical Path: {:.2}ms ({:.1}% of trace)\n\
             Path contains {} events\n\
             Total trace duration: {:.2}ms\n\
             \n\
             Events on critical path:",
            path_data.total_duration_ms,
            path_data.percentage_of_total,
            path_data.path_events,
            path_data.trace_total_duration_ms
        );

        // Create list of path events
        let mut content = vec![summary];

        for (i, event) in path_data.path.iter().enumerate() {
            let arrow = if i == 0 { "┌─→" } else if i == path_data.path.len() - 1 { "└─→" } else { "├─→" };
            let event_line = format!(
                "{} [{:.2}ms] {} @ {}",
                arrow,
                event.duration_ms,
                event.kind,
                event.location
            );
            content.push(event_line);
        }

        let text = content.join("\n");
        let widget = Paragraph::new(text)
            .block(block)
            .style(Style::default().fg(Color::Yellow))
            .wrap(Wrap { trim: true });

        f.render_widget(widget, area);
    } else {
        let widget = Paragraph::new("Loading critical path analysis...")
            .block(block)
            .style(Style::default().fg(Color::DarkGray));
        f.render_widget(widget, area);
    }
}

pub fn render_critical_path_list(
    f: &mut Frame,
    area: Rect,
    critical_path: &Option<CriticalPathData>,
    focused: bool,
    selected_index: usize,
) {
    let title = if focused {
        "🎯 Critical Path Events [j/k] ●"
    } else {
        "🎯 Critical Path Events [j/k]"
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(if focused {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default()
        });

    if let Some(path_data) = critical_path {
        let items: Vec<ListItem> = path_data
            .path
            .iter()
            .enumerate()
            .map(|(i, event)| {
                let is_selected = i == selected_index;
                let text = format!(
                    "{}. [{:.2}ms] {} @ {}",
                    i + 1,
                    event.duration_ms,
                    event.kind,
                    event.location
                );

                let style = if is_selected {
                    Style::default().fg(Color::Yellow).add_modifier(Modifier::BOLD | Modifier::REVERSED)
                } else {
                    Style::default().fg(Color::Yellow)
                };

                ListItem::new(text).style(style)
            })
            .collect();

        let widget = List::new(items).block(block);
        f.render_widget(widget, area);
    } else {
        let widget = Paragraph::new("No critical path data available")
            .block(block)
            .style(Style::default().fg(Color::DarkGray));
        f.render_widget(widget, area);
    }
}
