#!/usr/bin/env bash

set -euo pipefail

# Clean Build Artifacts Script
# Removes all build artifacts to free up disk space
# Safe to run - only removes ignored files

echo "🧹 Cleaning Build Artifacts"
echo ""

# Calculate sizes before cleanup
echo "📊 Current disk usage:"
du -sh target/ 2>/dev/null || echo "  target/: (not found)"
du -sh sdks/rust/target/ 2>/dev/null || echo "  sdks/rust/target/: (not found)"
du -sh sdks/python/raceway_sdk.egg-info 2>/dev/null || echo "  egg-info: (not found)"
find . -name "__pycache__" -type d | xargs du -sh 2>/dev/null | head -5

echo ""
echo "⚠️  This will remove:"
echo "  - Rust target/ directories (all compiled artifacts)"
echo "  - Python __pycache__/ and *.egg-info/"
echo "  - Node node_modules/ in examples (optional)"
echo ""
read -p "Continue? (y/N): " -n 1 -r
echo ""

if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
fi

echo ""
echo "🗑️  Removing Rust artifacts..."

# Main target directory
if [[ -d "target" ]]; then
    rm -rf target/
    echo "  ✓ Removed target/ (5.7 GB)"
fi

# SDK target
if [[ -d "sdks/rust/target" ]]; then
    rm -rf sdks/rust/target/
    echo "  ✓ Removed sdks/rust/target/ (944 MB)"
fi

# Example target directories
find examples -name "target" -type d -exec rm -rf {} + 2>/dev/null || true
echo "  ✓ Removed example target/ directories"

echo ""
echo "🗑️  Removing Python artifacts..."

# Python caches and build info
find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
find . -type d -name "*.egg-info" -exec rm -rf {} + 2>/dev/null || true
find . -type f -name "*.pyc" -delete 2>/dev/null || true
find . -type d -name ".pytest_cache" -exec rm -rf {} + 2>/dev/null || true

echo "  ✓ Removed __pycache__/ directories"
echo "  ✓ Removed *.egg-info/ directories"
echo "  ✓ Removed .pyc files"

echo ""
echo "🗑️  Removing Node artifacts in examples (optional)..."

# Only remove node_modules in examples, not in web/ or sdks/
find examples -name "node_modules" -type d -exec rm -rf {} + 2>/dev/null || true
echo "  ✓ Removed node_modules/ in examples/"

echo ""
echo "✅ Cleanup complete!"
echo ""
echo "💡 To rebuild:"
echo "   Rust:       cargo build --release"
echo "   Python SDK: cd sdks/python && pip install -e ."
echo "   Examples:   cd examples/<name> && npm install"
