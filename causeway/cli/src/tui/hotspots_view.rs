use ratatui::{
    layout::{Constraint, Direction, Layout, Rect},
    style::{Color, Style},
    widgets::{Block, Borders, List, ListItem},
    Frame,
};
use std::collections::HashMap;

/// Render the hotspots view showing problem areas and frequent operations
pub fn render_hotspots_view(
    f: &mut Frame,
    area: Rect,
    event_data: &[serde_json::Value],
) {
    // Split into two sections: Variables (left) and Functions/Services (right)
    let main_chunks = Layout::default()
        .direction(Direction::Horizontal)
        .constraints([Constraint::Percentage(50), Constraint::Percentage(50)])
        .split(area);

    // Split left side into variable hotspots (top) and state change frequency (bottom)
    let left_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
        .split(main_chunks[0]);

    // Split right side into function calls (top) and service activity (bottom)
    let right_chunks = Layout::default()
        .direction(Direction::Vertical)
        .constraints([Constraint::Percentage(60), Constraint::Percentage(40)])
        .split(main_chunks[1]);

    // Analyze event data to build hotspot statistics
    let mut variable_access_counts: HashMap<String, usize> = HashMap::new();
    let mut variable_write_counts: HashMap<String, usize> = HashMap::new();
    let mut function_call_counts: HashMap<String, usize> = HashMap::new();
    let mut service_event_counts: HashMap<String, usize> = HashMap::new();

    for event in event_data {
        // Track variable accesses
        if let Some(kind) = event.get("kind").and_then(|k| k.as_object()) {
            if let Some(state_change) = kind.get("StateChange") {
                if let Some(var) = state_change.get("variable").and_then(|v| v.as_str()) {
                    *variable_access_counts.entry(var.to_string()).or_insert(0) += 1;

                    if let Some(access_type) = state_change.get("access_type").and_then(|a| a.as_str()) {
                        if access_type == "Write" {
                            *variable_write_counts.entry(var.to_string()).or_insert(0) += 1;
                        }
                    }
                }
            }

            if let Some(func_call) = kind.get("FunctionCall") {
                if let Some(func_name) = func_call.get("function_name").and_then(|f| f.as_str()) {
                    *function_call_counts.entry(func_name.to_string()).or_insert(0) += 1;
                }
            }
        }

        // Track service activity
        if let Some(service) = event
            .get("metadata")
            .and_then(|m| m.get("service_name"))
            .and_then(|s| s.as_str())
        {
            *service_event_counts.entry(service.to_string()).or_insert(0) += 1;
        }
    }

    // Render variable hotspots
    render_variable_hotspots(f, left_chunks[0], &variable_access_counts);

    // Render variable write frequency
    render_variable_writes(f, left_chunks[1], &variable_write_counts);

    // Render function call frequency
    render_function_hotspots(f, right_chunks[0], &function_call_counts);

    // Render service activity
    render_service_activity(f, right_chunks[1], &service_event_counts);
}

fn render_variable_hotspots(
    f: &mut Frame,
    area: Rect,
    variable_counts: &HashMap<String, usize>,
) {
    let mut sorted_vars: Vec<_> = variable_counts.iter().collect();
    sorted_vars.sort_by(|a, b| b.1.cmp(a.1));

    let items: Vec<ListItem> = sorted_vars
        .into_iter()
        .take(area.height.saturating_sub(2) as usize)
        .map(|(var, count)| {
            let bar_length = (*count / 5).min(15);
            let bar = "█".repeat(bar_length);

            let color = if *count > 50 {
                Color::Red
            } else if *count > 20 {
                Color::Yellow
            } else {
                Color::Green
            };

            let text = format!("{:25} {} {:>4}", var, bar, count);
            ListItem::new(text).style(Style::default().fg(color))
        })
        .collect();

    let block = Block::default()
        .borders(Borders::ALL)
        .title("🔥 Most Accessed Variables")
        .border_style(Style::default().fg(Color::Red));

    let list = List::new(items).block(block);
    f.render_widget(list, area);
}

fn render_variable_writes(
    f: &mut Frame,
    area: Rect,
    write_counts: &HashMap<String, usize>,
) {
    let mut sorted_writes: Vec<_> = write_counts.iter().collect();
    sorted_writes.sort_by(|a, b| b.1.cmp(a.1));

    let items: Vec<ListItem> = sorted_writes
        .into_iter()
        .take(area.height.saturating_sub(2) as usize)
        .map(|(var, count)| {
            let bar_length = (*count / 3).min(12);
            let bar = "▓".repeat(bar_length);

            let color = if *count > 30 {
                Color::Red
            } else if *count > 10 {
                Color::Yellow
            } else {
                Color::Cyan
            };

            let text = format!("{:25} {} {:>4}", var, bar, count);
            ListItem::new(text).style(Style::default().fg(color))
        })
        .collect();

    let block = Block::default()
        .borders(Borders::ALL)
        .title("✏️  Write Frequency")
        .border_style(Style::default().fg(Color::Yellow));

    let list = List::new(items).block(block);
    f.render_widget(list, area);
}

fn render_function_hotspots(
    f: &mut Frame,
    area: Rect,
    function_counts: &HashMap<String, usize>,
) {
    let mut sorted_funcs: Vec<_> = function_counts.iter().collect();
    sorted_funcs.sort_by(|a, b| b.1.cmp(a.1));

    let items: Vec<ListItem> = sorted_funcs
        .into_iter()
        .take(area.height.saturating_sub(2) as usize)
        .map(|(func, count)| {
            // Truncate long function names
            let func_display = if func.len() > 30 {
                format!("{}...", &func[..27])
            } else {
                func.to_string()
            };

            let bar_length = (*count / 2).min(10);
            let bar = "█".repeat(bar_length);

            let color = if *count > 40 {
                Color::Red
            } else if *count > 15 {
                Color::Yellow
            } else {
                Color::Cyan
            };

            let text = format!("{:32} {} {:>3}", func_display, bar, count);
            ListItem::new(text).style(Style::default().fg(color))
        })
        .collect();

    let block = Block::default()
        .borders(Borders::ALL)
        .title("⚡ Function Call Frequency")
        .border_style(Style::default().fg(Color::Cyan));

    let list = List::new(items).block(block);
    f.render_widget(list, area);
}

fn render_service_activity(
    f: &mut Frame,
    area: Rect,
    service_counts: &HashMap<String, usize>,
) {
    let mut sorted_services: Vec<_> = service_counts.iter().collect();
    sorted_services.sort_by(|a, b| b.1.cmp(a.1));

    let total_events: usize = service_counts.values().sum();

    let items: Vec<ListItem> = sorted_services
        .into_iter()
        .take(area.height.saturating_sub(2) as usize)
        .map(|(service, count)| {
            let percentage = if total_events > 0 {
                (*count as f64 / total_events as f64 * 100.0) as usize
            } else {
                0
            };

            let bar_length = (percentage / 5).min(15);
            let bar = "█".repeat(bar_length);

            let text = format!(
                "{:20} {} {:>3}% ({:>4})",
                service, bar, percentage, count
            );

            ListItem::new(text).style(Style::default().fg(Color::Cyan))
        })
        .collect();

    let block = Block::default()
        .borders(Borders::ALL)
        .title("📊 Service Activity Distribution")
        .border_style(Style::default().fg(Color::Green));

    let list = List::new(items).block(block);
    f.render_widget(list, area);
}
