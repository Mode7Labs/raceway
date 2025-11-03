# Python Banking API - Raceway Demo

This demonstrates how Raceway can detect race conditions in a Python/Flask banking API.

## Quick Start

### 1. Start Raceway Server

```bash
cd ../..  # Go to root causeway directory
cargo run --release -- serve
```

The Raceway server will start on `http://localhost:8080`

### 2. Start the Banking API

```bash
cd examples/python-banking
pip install -r requirements.txt
python app.py
```

The banking app will start on `http://localhost:3053`

### 3. Open the Web UI

Open your browser to:
- **Banking App:** http://localhost:3053
- **Raceway Analysis:** http://localhost:3005 (Web UI)
  - Or use the TUI: `raceway tui` for terminal-based analysis

### 4. Trigger the Race Condition

In the banking app, click the **"Trigger Race Condition"** button.

### 5. View Results in Raceway

**Web UI:** Go to `http://localhost:3005` and:
- Select one of the traces from the left panel
- Navigate to the "Anomalies" or "Cross Trace" tab
- See the detected race condition with detailed analysis

**TUI:** Run `raceway tui` in your terminal for interactive trace analysis

## The Bug

The `/api/transfer` endpoint has a **read-modify-write race condition** due to releasing the lock between the read and write operations.

## How It Works

The banking API uses the Raceway SDK to track state changes, function calls, and HTTP events. Raceway analyzes these events to detect concurrent accesses to shared state without proper synchronization.

## Learn More

- [Raceway Documentation](../../README.md)
- [Getting Started Guide](../../docs/guide/getting-started.md)
- [Python SDK Documentation](../../docs/sdks/python.md)
- [Python SDK Reference](../../sdks/python/README.md)
