use anyhow::Result;
use clap::{Parser, Subcommand};
use raceway_core::Config;
use std::path::PathBuf;

mod server;
mod tui;

#[derive(Parser)]
#[command(name = "causeway")]
#[command(about = "AI-powered causal debugging for distributed systems", long_about = None)]
struct Cli {
    /// Path to configuration file
    #[arg(short, long, default_value = "raceway.toml")]
    config: PathBuf,

    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Start the Causeway server
    Serve {
        /// Override verbose setting from config
        #[arg(short, long)]
        verbose: bool,
    },

    /// Launch interactive TUI for trace visualization
    Tui {
        /// Override server URL from config
        #[arg(short, long)]
        server: Option<String>,
    },

    /// Analyze a specific trace
    Analyze {
        #[arg(short, long)]
        trace_id: String,

        /// Override server URL from config
        #[arg(short, long)]
        server: Option<String>,
    },

    /// Export trace data
    Export {
        #[arg(short, long)]
        trace_id: String,

        #[arg(short, long)]
        output: String,

        /// Override server URL from config
        #[arg(short, long)]
        server: Option<String>,
    },
}

#[tokio::main]
async fn main() -> Result<()> {
    let cli = Cli::parse();

    // Load configuration
    let mut config = if cli.config.exists() {
        println!("📝 Loading configuration from {:?}", cli.config);
        Config::from_file(&cli.config)?
    } else {
        println!(
            "⚠️  Config file not found at {:?}, using defaults",
            cli.config
        );
        Config::default()
    };

    // Validate configuration
    config.validate()?;

    // Build server URL from config
    let server_url = format!("http://{}:{}", config.server.host, config.server.port);

    match cli.command {
        Commands::Serve { verbose } => {
            // Allow CLI flag to override config
            if verbose {
                config.server.verbose = true;
            }

            println!(
                "🚀 Starting Raceway server on {}:{}",
                config.server.host, config.server.port
            );
            server::start_server(config).await?;
        }
        Commands::Tui { server } => {
            let server_url = server.unwrap_or(server_url);
            println!(
                "🎨 Launching Causeway TUI (connecting to {})...",
                server_url
            );
            tui::launch_tui(&server_url).await?;
        }
        Commands::Analyze { trace_id, server } => {
            let server_url = server.unwrap_or(server_url);
            println!(
                "🔍 Analyzing trace {} (server: {})...",
                trace_id, server_url
            );
            analyze_trace(&trace_id, &server_url).await?;
        }
        Commands::Export {
            trace_id,
            output,
            server,
        } => {
            let server_url = server.unwrap_or(server_url);
            println!(
                "📦 Exporting trace {} to {} (server: {})...",
                trace_id, output, server_url
            );
            export_trace(&trace_id, &output, &server_url).await?;
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
