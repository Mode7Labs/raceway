use anyhow::Result;
use clap::{Parser, Subcommand};

mod tui;
mod server;

#[derive(Parser)]
#[command(name = "causeway")]
#[command(about = "AI-powered causal debugging for distributed systems", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the Causeway server
    Serve {
        #[arg(short, long, default_value = "8080")]
        port: u16,

        #[arg(short, long, default_value = "127.0.0.1")]
        host: String,

        #[arg(short, long)]
        verbose: bool,
    },

    /// Launch interactive TUI for trace visualization
    Tui {
        #[arg(short, long, default_value = "http://localhost:8080")]
        server: String,
    },

    /// Analyze a specific trace
    Analyze {
        #[arg(short, long)]
        trace_id: String,

        #[arg(short, long, default_value = "http://localhost:8080")]
        server: String,
    },

    /// Export trace data
    Export {
        #[arg(short, long)]
        trace_id: String,

        #[arg(short, long)]
        output: String,

        #[arg(short, long, default_value = "http://localhost:8080")]
        server: String,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    match cli.command {
        Commands::Serve { port, host, verbose } => {
            println!("🚀 Starting Causeway server on {}:{}", host, port);
            server::start_server(host, port, verbose).await?;
        }
        Commands::Tui { server } => {
            println!("🎨 Launching Causeway TUI...");
            tui::launch_tui(&server).await?;
        }
        Commands::Analyze { trace_id, server } => {
            println!("🔍 Analyzing trace {}...", trace_id);
            analyze_trace(&trace_id, &server).await?;
        }
        Commands::Export { trace_id, output, server } => {
            println!("📦 Exporting trace {} to {}...", trace_id, output);
            export_trace(&trace_id, &output, &server).await?;
        }
    }

    Ok(())
}

async fn analyze_trace(trace_id: &str, server: &str) -> Result<()> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/api/traces/{}/analyze", server, trace_id))
        .send()
        .await?;

    let analysis: serde_json::Value = response.json().await?;
    println!("{}", serde_json::to_string_pretty(&analysis)?);

    Ok(())
}

async fn export_trace(trace_id: &str, output: &str, server: &str) -> Result<()> {
    let client = reqwest::Client::new();
    let response = client
        .get(format!("{}/api/traces/{}", server, trace_id))
        .send()
        .await?;

    let trace_data = response.text().await?;
    std::fs::write(output, trace_data)?;

    println!("✅ Trace exported to {}", output);
    Ok(())
}
