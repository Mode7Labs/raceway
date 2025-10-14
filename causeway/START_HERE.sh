#!/bin/bash

echo "🔍 Causeway - Quick Start"
echo "=========================="
echo ""

# Check if Rust is installed
if ! command -v cargo &> /dev/null; then
    echo "❌ Rust is not installed"
    echo ""
    echo "Install it with:"
    echo "  curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh"
    echo "  source \$HOME/.cargo/env"
    echo ""
    exit 1
fi

echo "✅ Rust is installed: $(cargo --version)"
echo ""

# Check if Node is installed
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed"
    exit 1
fi

echo "✅ Node.js is installed: $(node --version)"
echo ""

echo "📦 Building Causeway server..."
echo ""

cd "$(dirname "$0")"

if cargo build --release 2>&1 | grep -q "error"; then
    echo "❌ Build failed"
    echo "Try: rustup update"
    exit 1
fi

echo ""
echo "✨ Build complete!"
echo ""
echo "🚀 Starting server..."
echo ""
echo "   Press Ctrl+C to stop"
echo "   Open another terminal and run: node test-client.js"
echo "   Or visit: http://localhost:8080"
echo ""
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo ""

cargo run --release -- serve
