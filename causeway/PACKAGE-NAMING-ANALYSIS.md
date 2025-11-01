# Package Naming Analysis

## Current State (v0.1.0)

### Actual Package Names

| Ecosystem  | Package Name                             | Registry/Location       |
|------------|------------------------------------------|-------------------------|
| TypeScript | `@mode-7/raceway-node`                  | npm                     |
| Python     | `raceway`                                | PyPI                    |
| Go         | `github.com/mode7labs/raceway/sdks/go`  | Go modules (monorepo)   |
| Rust       | `raceway-sdk`                            | crates.io               |

### Installation Examples

```bash
# TypeScript/Node.js
npm install @mode-7/raceway-node

# Python
pip install raceway

# Go
go get github.com/mode7labs/raceway/sdks/go

# Rust
cargo add raceway-sdk
```

## Inconsistencies Identified

### 1. Organization/Scope Name Mismatch

**Issue**: TypeScript uses `@mode-7` (with hyphen) but GitHub and Go use `mode7labs` (no hyphen)

- GitHub: `github.com/mode7labs/raceway`
- TypeScript: `@mode-7/raceway-node`
- Go: `github.com/mode7labs/raceway/sdks/go`

**Impact**: Mild confusion when searching for packages or repositories

### 2. Language Suffix Inconsistency

**Issue**: Different suffixes across SDKs

- TypeScript: `-node` (platform identifier)
- Python: none (just `raceway`)
- Go: none (uses path `/sdks/go` instead)
- Rust: `-sdk` (generic SDK identifier)

**Impact**: Inconsistent mental model when looking for SDKs in different languages

### 3. Package Name Length & Clarity

| Package Name                             | Length | Clarity | Searchability |
|------------------------------------------|--------|---------|---------------|
| `@mode-7/raceway-node`                  | Long   | High    | Good          |
| `raceway`                                | Short  | Medium  | Excellent     |
| `github.com/mode7labs/raceway/sdks/go`  | Long   | High    | Good          |
| `raceway-sdk`                            | Medium | High    | Good          |

## Analysis by Ecosystem

### TypeScript/Node.js

**Current**: `@mode-7/raceway-node`

**Ecosystem Conventions**:
- Scoped packages are standard: `@org/package`
- Suffixes like `-node`, `-js` common for Node.js packages
- Examples: `@aws-sdk/client-s3`, `@opentelemetry/api`, `@sentry/node`

**Pros**:
- ✅ Follows npm scoping conventions
- ✅ Clear that it's for Node.js runtime
- ✅ Namespace prevents conflicts

**Cons**:
- ❌ Org name `mode-7` doesn't match GitHub `mode7labs`
- ❌ Could be confused with client-side browser package

**Alternatives**:
1. `@mode7labs/raceway-node` - Match GitHub org
2. `@raceway/node` - If we own the @raceway scope
3. `@mode-7/raceway` - Drop -node since it works in browsers too

### Python

**Current**: `raceway`

**Ecosystem Conventions**:
- Simple names preferred: `requests`, `flask`, `django`
- Hyphens discouraged (use underscores in code: `import raceway`)
- Examples: `opentelemetry-api`, `datadog`, `sentry-sdk`

**Pros**:
- ✅ Clean, memorable, easy to type
- ✅ `import raceway` matches package name
- ✅ Excellent searchability on PyPI

**Cons**:
- ❌ No organization/author indication
- ❌ Could potentially conflict with other "raceway" packages

**Alternatives**:
1. `raceway-sdk` - Explicit SDK indicator
2. `mode7labs-raceway` - Include org name
3. Keep as `raceway` - Best option if name is available

### Go

**Current**: `github.com/mode7labs/raceway/sdks/go`

**Ecosystem Conventions**:
- Full GitHub path is the module name
- Monorepo pattern: `domain.com/org/repo/path/to/package`
- Examples: `go.opentelemetry.io/otel`, `github.com/aws/aws-sdk-go-v2`

**Pros**:
- ✅ Standard Go monorepo pattern
- ✅ Matches GitHub organization exactly
- ✅ Clear path to source code
- ✅ Supports multiple packages in one repo

**Cons**:
- ❌ Longer import path
- ❌ `/sdks/go` feels redundant (but standard for monorepos)

**Alternatives**:
1. `github.com/mode7labs/raceway-go` - Separate repo (not recommended for monorepo)
2. Keep current - Best option for Go monorepos

### Rust

**Current**: `raceway-sdk`

**Ecosystem Conventions**:
- Hyphens standard: `serde-json`, `tokio-util`
- Often includes suffix: `-core`, `-sdk`, `-client`
- Examples: `opentelemetry-sdk`, `aws-sdk-rust`, `sentry-core`

**Pros**:
- ✅ Follows Rust naming conventions
- ✅ Clear SDK designation
- ✅ Easy to remember

**Cons**:
- ❌ No organization indication (crates.io doesn't have namespaces)
- ❌ Different pattern than Python (which has no `-sdk`)

**Alternatives**:
1. `raceway` - Match Python simplicity
2. `raceway-rust` - Explicit language indicator
3. Keep `raceway-sdk` - Current is good

## Recommendations

### Option A: Align Org Names (Minimal Breaking Change)

**Recommended for 0.1.0 release**

Only fix the org name mismatch:

```diff
# TypeScript
- @mode-7/raceway-node
+ @mode7labs/raceway-node

# Python - no change
raceway

# Go - no change
github.com/mode7labs/raceway/sdks/go

# Rust - no change
raceway-sdk
```

**Pros**:
- ✅ Fixes the main inconsistency (org name)
- ✅ Minimal disruption
- ✅ Each SDK follows its ecosystem conventions

**Cons**:
- ❌ Still have inconsistent suffixes (-node, none, -sdk)

**Breaking Change Impact**: Low
- Only affects TypeScript users
- Easy migration: update package.json

### Option B: Full Standardization with Suffixes

**Future consideration (post-0.1.0)**

Standardize all packages with language suffixes:

```diff
# TypeScript
@mode7labs/raceway-node

# Python
- raceway
+ raceway-python  # or raceway-py

# Go
github.com/mode7labs/raceway/sdks/go  # Go doesn't use package-level suffixes

# Rust
- raceway-sdk
+ raceway-rust  # or raceway-rs
```

**Pros**:
- ✅ Completely consistent across languages
- ✅ Clear which language each SDK is for

**Cons**:
- ❌ Goes against Python conventions (simple names preferred)
- ❌ Breaking change for all existing users
- ❌ Less discoverable (people search for "raceway" not "raceway-python")

**Breaking Change Impact**: High

### Option C: No Language Suffixes (Consistent Simplicity)

**Alternative future consideration**

Remove language suffixes where possible:

```diff
# TypeScript
- @mode7labs/raceway-node
+ @mode7labs/raceway

# Python
raceway  # no change

# Go
github.com/mode7labs/raceway/sdks/go  # Path provides context

# Rust
- raceway-sdk
+ raceway
```

**Pros**:
- ✅ Simpler to remember
- ✅ Follows Python's lead (most popular scripting language)
- ✅ TypeScript SDK works in browser too, so -node is misleading

**Cons**:
- ❌ Potential conflicts on registries without namespaces
- ❌ Python already has "raceway" name (might not be available on npm)
- ❌ Less explicit about intended runtime

**Breaking Change Impact**: Medium-High

### Option D: Keep Current (Document Intent)

**Status quo**

Keep all current names and document the reasoning:

```bash
@mode-7/raceway-node     # mode-7 is the npm org, -node for Node.js
raceway                   # Simple Python convention
github.com/mode7labs/raceway/sdks/go  # Go monorepo pattern
raceway-sdk               # Rust SDK convention
```

**Pros**:
- ✅ No breaking changes
- ✅ Each follows language-specific best practices
- ✅ No migration needed

**Cons**:
- ❌ Org name inconsistency remains (mode-7 vs mode7labs)
- ❌ Requires explanation in docs

## Final Recommendation for 0.1.0 (UPDATED)

**Choose: Simplified Consistent Naming**

Based on actual account availability:
- ✅ npm: `@mode-7` scope is owned and available
- ✅ PyPI: `raceway` is available
- ✅ crates.io: `raceway` is available (verified 404)

### Recommended Package Names:

| Ecosystem  | Package Name                             | Change      |
|------------|------------------------------------------|-------------|
| TypeScript | `@mode-7/raceway`                       | Drop `-node`|
| Python     | `raceway`                                | No change   |
| Go         | `github.com/mode7labs/raceway/sdks/go`  | No change   |
| Rust       | `raceway`                                | Drop `-sdk` |

### Actions Required:

1. **TypeScript SDK** - Update package name:
   ```diff
   - "name": "@mode-7/raceway-node"
   + "name": "@mode-7/raceway"
   ```

2. **Rust SDK** - Update package name:
   ```diff
   - name = "raceway-sdk"
   + name = "raceway"
   ```

3. **Update Documentation** - All references:
   - Main README.md
   - SDK-specific READMEs
   - Example code
   - Production deployment guide

4. **Publishing**:
   - Publish `@mode-7/raceway` to npm (first publish)
   - Publish `raceway` to crates.io (first publish)
   - Keep PyPI as `raceway` (unchanged)

5. **Document Package Names** in main README:
   ```markdown
   ## Installation

   | Language   | Package Manager | Install Command                          |
   |------------|-----------------|------------------------------------------|
   | TypeScript | npm/yarn        | `npm install @mode-7/raceway`            |
   | Python     | pip             | `pip install raceway`                    |
   | Go         | go get          | `go get github.com/mode7labs/raceway/sdks/go` |
   | Rust       | cargo           | `cargo add raceway`                      |
   ```

### Rationale:

1. **Maximum Consistency**: 3 out of 4 SDKs use just "raceway"
2. **Clean & Memorable**: Simple names are easier to remember and type
3. **Respects Ownership**: Uses `@mode-7` scope that you already own
4. **Namespace Protection**: npm scope prevents conflicts
5. **Future-Proof**: Clean naming for long-term maintenance
6. **Works Everywhere**: `@mode-7/raceway` works in Node.js AND browsers

### Why Drop `-node` and `-sdk` Suffixes?

**TypeScript (`-node` → none)**:
- The SDK works in both Node.js and browser environments
- The `@mode-7` scope provides namespace protection
- Simpler to remember: `@mode-7/raceway`

**Rust (`-sdk` → none)**:
- Matches Python's simple naming
- All packages are SDKs by nature
- Shorter: `raceway` vs `raceway-sdk`

### Long-term Consideration (Post-1.0):

After gathering user feedback, consider **Option C** (no suffixes) for consistency:
- Acquire `@raceway` npm scope if possible
- Rename to `@raceway/node` or just `@raceway` (if works in browser)
- Keep Python as `raceway` (already perfect)
- Consider `raceway` for Rust (drop `-sdk`)

This would give ultimate consistency:
```
@raceway/node (or @raceway)
raceway
github.com/mode7labs/raceway/sdks/go
raceway
```

## Implementation Checklist for Option A

- [ ] Update `sdks/typescript/package.json` name field
- [ ] Update all README.md files referencing the package
- [ ] Update all example code/documentation
- [ ] Update web UI if it displays package name
- [ ] Create deprecation notice for @mode-7/raceway-node
- [ ] Publish @mode7labs/raceway-node to npm
- [ ] Add migration guide to release notes
- [ ] Update GitHub repository topics/description

## Conclusion

While perfect consistency across all ecosystems is ideal, respecting each language's conventions is more important for developer experience. The minimal fix of aligning the org name (`mode-7` → `mode7labs`) solves the primary confusion while keeping each SDK idiomatic.

For a 0.1.0 release, **Option A is strongly recommended** as the right balance of consistency and pragmatism.
