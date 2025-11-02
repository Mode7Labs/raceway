# Raceway Release Process

This document outlines the complete process for releasing Raceway 0.1.0 and future versions.

## Current Status (Pre-0.1.0)

- ✅ All packages at version 0.1.0
- ✅ CHANGELOG.md created
- ✅ Web UI organized and building
- ✅ Documentation reviewed (no hype)
- ⏳ Ready to commit and release

## Release Components

Raceway consists of multiple independently versioned components:

1. **Core Server & CLI** (Rust workspace) - `v0.1.0`
2. **Web UI** (npm package) - `v0.1.0`
3. **TypeScript SDK** (npm package `@mode-7/raceway`) - `v0.1.0`
4. **Python SDK** (PyPI package `raceway`) - `v0.1.0`
5. **Go SDK** (Go module) - `v0.1.0` (via Git tags)
6. **Rust SDK** (crates.io `raceway-client`) - `v0.1.0`

## Pre-Release Checklist

### 1. Testing
- [ ] Run all unit tests: `cargo test --workspace`
- [ ] Run TypeScript SDK tests: `cd sdks/typescript && npm test`
- [ ] Run Python SDK tests: `cd sdks/python && python -m pytest`
- [ ] Run Go SDK tests: `cd sdks/go && go test ./...`
- [ ] Build Web UI: `cd web && npm run build`
- [ ] Run example applications (smoke test)
- [ ] Test TUI: `cargo run -- tui`

### 2. Documentation
- [x] README.md is up to date
- [x] CHANGELOG.md created with 0.1.0 release notes
- [x] SDK READMEs are current
- [x] Examples have clear instructions
- [ ] API documentation generated (if applicable)

### 3. Version Verification
- [x] Core: `Cargo.toml` → `version = "0.1.0"`
- [x] Web UI: `web/package.json` → `"version": "0.1.0"`
- [x] TypeScript SDK: `sdks/typescript/package.json` → `"version": "0.1.0"`
- [x] Python SDK: `sdks/python/pyproject.toml` → `version = "0.1.0"`
- [x] Rust SDK: `sdks/rust/Cargo.toml` → `version = "0.1.0"`
- [x] Go SDK: Will be versioned via Git tag `sdks/go/v0.1.0`

### 4. Repository Clean
- [ ] No uncommitted changes (except this RELEASE.md if you want to keep it)
- [ ] All tests passing in CI (if configured)
- [ ] No sensitive data (API keys, credentials) in files

## Release Steps

### Phase 1: Commit Final Changes

```bash
# 1. Verify clean state
git status

# 2. Commit CHANGELOG and any final changes
git add CHANGELOG.md
git commit -m "docs: add CHANGELOG for 0.1.0 release"

# 3. Push to main branch
git push origin main
```

### Phase 2: Create Git Tags

Git tags are used for:
- Core repository versioning
- Go SDK versioning (Go uses Git tags for versions)

```bash
# 1. Create main repository tag
git tag -a v0.1.0 -m "Release v0.1.0

Initial release of Raceway - causality tracking engine for distributed systems.

Key features:
- Vector clock-based event ordering
- Race condition detection
- Critical path analysis
- Distributed tracing
- 4 SDK languages (TypeScript, Python, Go, Rust)
- Terminal UI and Web UI
- PostgreSQL persistence option

See CHANGELOG.md for full details."

# 2. Create Go SDK specific tag (required for Go modules)
git tag -a sdks/go/v0.1.0 -m "Release Go SDK v0.1.0

First stable release of the Raceway Go SDK."

# 3. Push all tags
git push origin v0.1.0
git push origin sdks/go/v0.1.0

# 4. Verify tags are pushed
git ls-remote --tags origin
```

**Important:** Go modules use the full tag path `sdks/go/v0.1.0` for versioning.

### Phase 3: Publish Packages

Publish in this order to respect dependencies:

#### 3A. Publish Core Rust Crates (Optional)

The core server is not typically published to crates.io since users run from source.
Skip unless you want `raceway-core` to be a library.

#### 3B. Publish Rust SDK to crates.io

```bash
cd sdks/rust

# 1. Verify package contents
cargo package --list

# 2. Dry run publish
cargo publish --dry-run

# 3. Actual publish (requires crates.io authentication)
cargo publish

# 4. Verify on crates.io
# Visit: https://crates.io/crates/raceway-client
```

**Authentication:** Run `cargo login` with your crates.io API token first.

#### 3C. Publish TypeScript SDK to npm

```bash
cd sdks/typescript

# 1. Verify package contents
npm pack --dry-run

# 2. Build the package
npm run build

# 3. Verify tests pass
npm test

# 4. Publish (requires npm authentication)
npm publish --access public

# 5. Verify on npm
# Visit: https://www.npmjs.com/package/@mode-7/raceway
```

**Authentication:** Run `npm login` first. Ensure you're in the `@mode-7` organization.

#### 3D. Publish Python SDK to PyPI

```bash
cd sdks/python

# 1. Clean old builds
rm -rf dist/ build/ *.egg-info

# 2. Build the package
python -m build

# 3. Verify package contents
tar -tzf dist/raceway-0.1.0.tar.gz

# 4. Check package with twine
twine check dist/*

# 5. Upload to TestPyPI (optional, for testing)
twine upload --repository testpypi dist/*

# 6. Test install from TestPyPI
pip install --index-url https://test.pypi.org/simple/ raceway==0.1.0

# 7. Upload to production PyPI
twine upload dist/*

# 8. Verify on PyPI
# Visit: https://pypi.org/project/raceway/
```

**Authentication:** Run `twine upload` will prompt for PyPI credentials, or configure `~/.pypirc`.

#### 3E. Go SDK (No Action Required)

Go SDK is automatically available via Git tags. Users import with:

```go
import "github.com/mode7labs/raceway/sdks/go"
```

Go will automatically fetch version `v0.1.0` using the `sdks/go/v0.1.0` tag.

**Verification:**
```bash
# Test that Go can fetch it
go get github.com/mode7labs/raceway/sdks/go@v0.1.0
```

### Phase 4: Create GitHub Release

```bash
# Option A: Using GitHub CLI
gh release create v0.1.0 \
  --title "Raceway v0.1.0" \
  --notes-file CHANGELOG.md \
  --target main

# Option B: Manual (via GitHub web interface)
# 1. Go to: https://github.com/mode7labs/raceway/releases/new
# 2. Choose tag: v0.1.0
# 3. Title: "Raceway v0.1.0"
# 4. Copy-paste CHANGELOG.md content into description
# 5. Check "Set as latest release"
# 6. Publish release
```

**Attach Assets (Optional):**
- Pre-built binaries (if you build for multiple platforms)
- Checksums

### Phase 5: Post-Release Verification

```bash
# 1. Verify all packages are published
npm view @mode-7/raceway version          # Should show 0.1.0
pip show raceway                          # Should show 0.1.0
cargo search raceway-client --limit 1     # Should show 0.1.0
go list -m github.com/mode7labs/raceway/sdks/go@v0.1.0

# 2. Test fresh installations
npm install @mode-7/raceway@0.1.0
pip install raceway==0.1.0
go get github.com/mode7labs/raceway/sdks/go@v0.1.0

# 3. Verify GitHub release page
# Visit: https://github.com/mode7labs/raceway/releases/tag/v0.1.0

# 4. Check documentation links work
# README badges, links to docs, etc.
```

### Phase 6: Announcements (Optional)

- [ ] Post on project website/blog
- [ ] Social media announcements (Twitter, LinkedIn, etc.)
- [ ] Hacker News/Reddit (if appropriate)
- [ ] Email newsletter (if you have one)
- [ ] Update any roadmaps or project boards

## Version Bumping for Next Release

After 0.1.0 is released, bump to 0.2.0-dev:

```bash
# Update all version fields to 0.2.0-dev or keep at 0.1.0 until ready
# This signals that main branch is now working towards 0.2.0

# Core
sed -i '' 's/version = "0.1.0"/version = "0.2.0-dev"/' Cargo.toml

# Web UI
cd web && npm version 0.2.0-dev --no-git-tag-version

# TypeScript SDK
cd ../sdks/typescript && npm version 0.2.0-dev --no-git-tag-version

# Python SDK
sed -i '' 's/version = "0.1.0"/version = "0.2.0-dev"/' sdks/python/pyproject.toml

# Rust SDK
sed -i '' 's/version = "0.1.0"/version = "0.2.0-dev"/' sdks/rust/Cargo.toml

# Commit
git add -A
git commit -m "chore: bump versions to 0.2.0-dev"
git push origin main
```

## Troubleshooting

### npm publish fails with 403

**Problem:** You don't have permission to publish to the `@mode-7` organization.

**Solution:**
1. Verify you're logged in: `npm whoami`
2. Check organization membership: `npm org ls @mode-7 <username>`
3. Request access or change package name

### PyPI upload fails

**Problem:** Package name already exists or authentication issue.

**Solution:**
1. Check if package exists: `pip search raceway`
2. Verify credentials in `~/.pypirc`
3. Use `twine upload --verbose` for detailed errors

### Go module not found

**Problem:** `go get` can't find the module after tagging.

**Solution:**
1. Verify tag is pushed: `git ls-remote --tags origin`
2. Wait a few minutes (Go proxy cache)
3. Try with explicit version: `go get github.com/mode7labs/raceway/sdks/go@v0.1.0`
4. Clear Go module cache: `go clean -modcache`

### Crates.io publish fails

**Problem:** Package name taken or authentication failed.

**Solution:**
1. Login again: `cargo login`
2. Check package name availability on crates.io
3. Verify Cargo.toml metadata is complete

## Emergency: Rolling Back a Release

If you need to yank/unpublish a release:

```bash
# npm
npm unpublish @mode-7/raceway@0.1.0

# PyPI (yanking is preferred over deletion)
# Must do via web interface: https://pypi.org/manage/project/raceway/releases/

# crates.io
cargo yank --vers 0.1.0 raceway-client

# GitHub Release
gh release delete v0.1.0
git push origin :refs/tags/v0.1.0  # Delete remote tag
git tag -d v0.1.0                   # Delete local tag
```

**Note:** Yanking/unpublishing should be a last resort. Consider publishing a patch version instead.

## Future Release Process

For subsequent releases (0.2.0, 1.0.0, etc.):

1. Update CHANGELOG.md with new version section
2. Bump all version numbers
3. Follow the same release steps above
4. Update this document if the process changes

## Checklist Summary

Quick reference for release day:

```bash
# Pre-flight
[ ] All tests pass
[ ] Documentation updated
[ ] CHANGELOG.md has release notes
[ ] Versions verified

# Release
[ ] Commit final changes
[ ] Create & push Git tags (v0.1.0 and sdks/go/v0.1.0)
[ ] Publish Rust SDK (crates.io)
[ ] Publish TypeScript SDK (npm)
[ ] Publish Python SDK (PyPI)
[ ] Create GitHub Release
[ ] Verify all packages published
[ ] Test fresh installations

# Post-release
[ ] Bump versions to next dev version
[ ] Update roadmap
[ ] Announcements
```

---

**Last Updated:** 2024-11-02
**Next Review:** Before 0.2.0 release
