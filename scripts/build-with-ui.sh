#!/bin/bash

# Build Raceway with embedded WebUI
# This script builds the WebUI and then the Rust binary

set -e

echo "🔨 Building Raceway with WebUI..."

# Build WebUI
echo "📦 Building WebUI..."
cd web
npm install
npm run build
cd ..

# Build Rust binary
echo "🦀 Building Rust server..."
cargo build --release

echo "✅ Build complete!"
echo ""
echo "Run with: ./target/release/raceway serve"
echo "WebUI will be available at http://localhost:8080"
