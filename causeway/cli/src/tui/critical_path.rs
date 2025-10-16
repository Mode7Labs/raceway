use crate::tui::types::CriticalPathData;
use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, List, ListItem, Paragraph},
    Frame,
};

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
                    Style::default()
                        .fg(Color::Yellow)
                        .add_modifier(Modifier::BOLD | Modifier::REVERSED)
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
