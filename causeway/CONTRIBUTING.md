# Contributing to Causeway

First off, thank you for considering contributing to Causeway! It's people like you that make Causeway such a great tool.

## Code of Conduct

This project and everyone participating in it is governed by our Code of Conduct. By participating, you are expected to uphold this code.

## How Can I Contribute?

### Reporting Bugs

Before creating bug reports, please check existing issues. When you are creating a bug report, please include as many details as possible:

* Use a clear and descriptive title
* Describe the exact steps which reproduce the problem
* Provide specific examples to demonstrate the steps
* Describe the behavior you observed after following the steps
* Explain which behavior you expected to see instead and why
* Include screenshots if relevant

### Suggesting Enhancements

Enhancement suggestions are tracked as GitHub issues. When creating an enhancement suggestion, please include:

* A clear and descriptive title
* A detailed description of the proposed functionality
* Explain why this enhancement would be useful
* List some examples of how it would be used

### Pull Requests

* Fill in the required template
* Follow the Rust/TypeScript/Python style guides
* Include tests when adding features
* Update documentation as needed
* End all files with a newline

## Development Setup

### Prerequisites

* Rust 1.70+
* Node.js 18+
* Python 3.9+
* Git

### Getting Started

1. Fork the repo
2. Clone your fork
3. Create a branch for your changes
4. Make your changes
5. Run tests
6. Push to your fork
7. Open a Pull Request

```bash
# Clone
git clone https://github.com/YOUR_USERNAME/causeway.git
cd causeway

# Build Rust components
cargo build

# Build TypeScript components
cd instrumentation
npm install
npm run build

# Run tests
cargo test
npm test
```

## Style Guides

### Rust

* Follow standard Rust formatting (use `cargo fmt`)
* Use `cargo clippy` and fix all warnings
* Write tests for new functionality
* Document public APIs

### TypeScript

* Use TypeScript strict mode
* Follow the existing code style
* Write JSDoc comments for public APIs
* Include type definitions

### Python

* Follow PEP 8
* Use type hints
* Write docstrings
* Use Black for formatting

## Testing

* Write unit tests for all new functionality
* Ensure all tests pass before submitting PR
* Include integration tests where appropriate

## Documentation

* Update README.md if you change functionality
* Add JSDoc/Rustdoc comments to public APIs
* Update examples if behavior changes

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
