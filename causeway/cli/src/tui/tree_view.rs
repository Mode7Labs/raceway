use ratatui::{
    layout::Rect,
    style::{Color, Modifier, Style},
    widgets::{Block, Borders, List, ListItem},
    Frame,
};

/// Represents a node in the event tree
#[derive(Clone)]
pub struct TreeNode {
    pub event_id: String,
    pub event_kind: String,
    pub timestamp: String,
    pub depth: usize,
    pub is_last_child: Vec<bool>, // Track if this node is the last child at each depth level
    pub children_count: usize,
}

/// Build a tree structure from events using parent_id relationships
pub fn build_tree(events: &[serde_json::Value]) -> Vec<TreeNode> {
    use std::collections::HashMap;

    // Build parent-child map
    let mut children_map: HashMap<String, Vec<usize>> = HashMap::new();
    let mut roots = Vec::new();

    for (idx, event) in events.iter().enumerate() {
        if let Some(parent_id) = event.get("parent_id").and_then(|p| p.as_str()) {
            children_map.entry(parent_id.to_string())
                .or_insert_with(Vec::new)
                .push(idx);
        } else {
            roots.push(idx);
        }
    }

    let mut tree_nodes = Vec::new();

    // Recursive function to traverse tree
    fn traverse(
        idx: usize,
        events: &[serde_json::Value],
        children_map: &HashMap<String, Vec<usize>>,
        tree_nodes: &mut Vec<TreeNode>,
        depth: usize,
        is_last_child: Vec<bool>,
    ) {
        let event = &events[idx];
        let event_id = event.get("id")
            .and_then(|id| id.as_str())
            .unwrap_or("unknown");

        let event_kind = event.get("kind")
            .and_then(|k| {
                if let Some(obj) = k.as_object() {
                    obj.keys().next().map(|s| s.as_str())
                } else {
                    None
                }
            })
            .unwrap_or("Unknown");

        let timestamp = event.get("timestamp")
            .and_then(|t| t.as_str())
            .unwrap_or("?");

        let children = children_map.get(event_id).map(|v| v.as_slice()).unwrap_or(&[]);

        tree_nodes.push(TreeNode {
            event_id: event_id[..8.min(event_id.len())].to_string(),
            event_kind: event_kind.to_string(),
            timestamp: if timestamp.len() >= 19 {
                timestamp[11..19].to_string()
            } else {
                timestamp.to_string()
            },
            depth,
            is_last_child: is_last_child.clone(),
            children_count: children.len(),
        });

        // Traverse children
        for (i, &child_idx) in children.iter().enumerate() {
            let is_last = i == children.len() - 1;
            let mut child_is_last = is_last_child.clone();
            child_is_last.push(is_last);
            traverse(child_idx, events, children_map, tree_nodes, depth + 1, child_is_last);
        }
    }

    // Start from root events
    for (i, &root_idx) in roots.iter().enumerate() {
        let is_last = i == roots.len() - 1;
        traverse(root_idx, events, &children_map, &mut tree_nodes, 0, vec![is_last]);
    }

    tree_nodes
}

/// Render the tree view
pub fn render_tree_view(
    f: &mut Frame,
    area: Rect,
    events: &[serde_json::Value],
    focused: bool,
    selected: usize,
    events_in_races: &std::collections::HashSet<String>,
) {
    let tree_nodes = build_tree(events);

    let items: Vec<ListItem> = tree_nodes
        .iter()
        .enumerate()
        .map(|(idx, node)| {
            // Build tree prefix
            let mut prefix = String::new();

            // Add vertical lines for parent depths
            for (depth_idx, &is_last) in node.is_last_child.iter().enumerate() {
                if depth_idx < node.is_last_child.len() - 1 {
                    if is_last {
                        prefix.push_str("    ");
                    } else {
                        prefix.push_str("│   ");
                    }
                }
            }

            // Add branch for current node
            if node.depth > 0 {
                if node.is_last_child.last() == Some(&true) {
                    prefix.push_str("└── ");
                } else {
                    prefix.push_str("├── ");
                }
            }

            let children_indicator = if node.children_count > 0 {
                format!(" [{}]", node.children_count)
            } else {
                String::new()
            };

            let line = format!(
                "{}[{}] {}{}",
                prefix,
                node.timestamp,
                node.event_kind,
                children_indicator
            );

            // Check if this event is involved in a race
            let event_in_race = events_in_races.contains(&node.event_id);
            let is_selected = idx == selected;

            let style = match (is_selected, event_in_race) {
                (true, true) => Style::default().fg(Color::Red).add_modifier(Modifier::BOLD),
                (true, false) => Style::default().fg(Color::Green).add_modifier(Modifier::BOLD),
                (false, true) => Style::default().fg(Color::Red),
                (false, false) => Style::default(),
            };

            ListItem::new(line).style(style)
        })
        .collect();

    let title = if focused {
        "🌳 Event Tree [j/k] ●"
    } else {
        "🌳 Event Tree [j/k]"
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
