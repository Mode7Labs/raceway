use super::types::AuditTrailData;
use ratatui::{
    layout::Rect,
    style::{Color, Style},
    widgets::{Block, Borders, Paragraph, Wrap},
    Frame,
};

pub fn render_audit_trail_view(
    f: &mut Frame,
    area: Rect,
    data: &Option<AuditTrailData>,
    focused: bool,
) {
    let title = if focused {
        "📋 Audit Trail ●"
    } else {
        "📋 Audit Trail"
    };

    let block = Block::default()
        .borders(Borders::ALL)
        .title(title)
        .border_style(if focused {
            Style::default().fg(Color::Cyan)
        } else {
            Style::default()
        });

    if let Some(trail) = data {
        if trail.accesses.is_empty() {
            let empty_text = format!("No accesses found for variable: {}", trail.variable);
            let widget = Paragraph::new(empty_text)
                .block(block)
                .wrap(Wrap { trim: true });
            f.render_widget(widget, area);
            return;
        }

        // Build audit trail display
        let mut lines = Vec::new();

        let race_count = trail.accesses.iter().filter(|a| a.is_race).count();

        lines.push(format!("Variable: {}", trail.variable));
        lines.push(format!("Total Accesses: {}", trail.accesses.len()));
        if race_count > 0 {
            lines.push(format!("⚠️  Race Conditions: {}", race_count));
        }
        lines.push(String::new());
        lines.push("Timeline:".to_string());
        lines.push(String::new());

        for (idx, access) in trail.accesses.iter().enumerate() {
            // Parse timestamp for display
            let time_display =
                if let Ok(parsed) = chrono::DateTime::parse_from_rfc3339(&access.timestamp) {
                    parsed.format("%H:%M:%S%.3f").to_string()
                } else {
                    access.timestamp.clone()
                };

            // Access type indicator
            let type_indicator = match access.access_type.as_str() {
                "Write" => "✍",
                "Read" => "👁",
                "AtomicWrite" => "⚛✍",
                "AtomicRead" => "⚛👁",
                "AtomicRMW" => "⚛↻",
                _ => "•",
            };

            // Race indicator
            let race_marker = if access.is_race { " ⚠️ RACE" } else { "" };

            lines.push(format!(
                "{} {} [{}] @ {}{}",
                type_indicator, access.access_type, access.thread_id, time_display, race_marker
            ));

            // Service and location
            lines.push(format!(
                "   Service: {} | Location: {}",
                access.service_name, access.location
            ));

            // Value change
            if let Some(ref old_val) = access.old_value {
                lines.push(format!(
                    "   Value: {} → {}",
                    old_val,
                    access.new_value
                ));
            } else {
                lines.push(format!("   Value: {}", access.new_value));
            }

            // Causal link info
            if idx > 0 {
                if access.has_causal_link_to_previous {
                    lines.push("   ↓ Causal influence from previous".to_string());
                } else if access.is_race {
                    lines.push("   ⚠️  NO CAUSAL LINK - POTENTIAL RACE".to_string());
                } else {
                    lines.push("   ⋮ Concurrent with previous".to_string());
                }
            }

            lines.push(String::new());
        }

        let text = lines.join("\n");
        let widget = Paragraph::new(text).block(block).wrap(Wrap { trim: true });
        f.render_widget(widget, area);
    } else {
        let info_text = "No audit trail loaded.\nPress 'v' when viewing race conditions to load audit trail for a variable.";
        let widget = Paragraph::new(info_text)
            .block(block)
            .wrap(Wrap { trim: true });
        f.render_widget(widget, area);
    }
}
