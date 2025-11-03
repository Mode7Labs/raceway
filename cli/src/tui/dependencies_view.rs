use super::types::DependenciesData;
use ratatui::{
    layout::Rect,
    style::{Color, Style},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame,
};

pub fn render_dependencies_view(
    f: &mut Frame,
    area: Rect,
    data: &Option<DependenciesData>,
    focused: bool,
) {
    let title = if focused {
        "🔗 Service Dependencies ●"
    } else {
        "🔗 Service Dependencies"
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(if focused {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default()
        });

    if let Some(deps) = data {
        if deps.services.is_empty() {
            let empty_text = "No services found in this trace";
            let widget = Paragraph::new(empty_text)
                .block(block)
                .wrap(Wrap { trim: true });
            f.render_widget(widget, area);
            return;
        }

        // Build ASCII art dependency graph
        let mut lines = Vec::new();

        lines.push(format!("Total Services: {}", deps.services.len()));
        lines.push(format!("Cross-Service Calls: {}", deps.dependencies.len()));
        lines.push(String::new());

        // Sort services by event count (desc)
        let mut sorted_services = deps.services.clone();
        sorted_services.sort_by(|a, b| b.event_count.cmp(&a.event_count));

        lines.push("Services:".to_string());
        for service in &sorted_services {
            lines.push(format!(
                "  • {} ({} events)",
                service.name, service.event_count
            ));
        }

        if !deps.dependencies.is_empty() {
            lines.push(String::new());
            lines.push("Dependencies:".to_string());

            for dep in &deps.dependencies {
                lines.push(format!("  {} ─[{}]→ {}", dep.from, dep.call_count, dep.to));
            }
        } else {
            lines.push(String::new());
            lines.push("✓ No cross-service dependencies".to_string());
            lines.push("  (All events within same service)".to_string());
        }

        let text = lines.join("\n");
        let widget = Paragraph::new(text).block(block).wrap(Wrap { trim: true });
        f.render_widget(widget, area);
    } else {
        let loading_text = "Loading dependencies...";
        let widget = Paragraph::new(loading_text)
            .block(block)
            .wrap(Wrap { trim: true });
        f.render_widget(widget, area);
    }
}
