# Package Naming Changes for 0.1.0 Release

## Summary

Updated package names across all SDKs for consistency and simplicity.

### Changes Made

| SDK        | Old Name                   | New Name                  | Status |
|------------|----------------------------|---------------------------|--------|
| TypeScript | `@mode-7/raceway-node`    | `@mode-7/raceway`        | ✅ Done |
| Python     | `raceway`                  | `raceway`                 | ✅ No change |
| Go         | `github.com/mode7labs/raceway/sdks/go` | `github.com/mode7labs/raceway/sdks/go` | ✅ No change |
| Rust       | `raceway-sdk`              | `raceway`                 | ✅ Done |

## Installation Commands (Updated)

```bash
# TypeScript/Node.js
npm install @mode-7/raceway

# Python
pip install raceway

# Go
go get github.com/mode7labs/raceway/sdks/go

# Rust
cargo add raceway
```

## Rationale

1. **Maximum Consistency**: 3 out of 4 SDKs now use just "raceway"
2. **Simpler Names**: Easier to remember and type
3. **Namespace Protection**: `@mode-7` scope on npm prevents conflicts
4. **Universal SDK**: TypeScript SDK works in both Node.js and browsers, so `-node` suffix was misleading
5. **Availability Verified**:
   - ✅ `raceway` available on PyPI
   - ✅ `raceway` available on crates.io (verified)
   - ✅ `@mode-7` scope owned by maintainer

## Files Updated

### Package Metadata
- [x] `sdks/typescript/package.json` - Changed name to `@mode-7/raceway`
- [x] `sdks/rust/Cargo.toml` - Changed name to `raceway`

### Documentation
- [x] `README.md` - Updated SDK list and production deployment examples
- [x] `sdks/typescript/README.md` - Updated all references
- [x] `sdks/typescript/CONTRIBUTING.md` - Updated all references
- [x] `sdks/typescript/INSTRUMENTATION-GUIDE.md` - Updated all references
- [x] `sdks/rust/README.md` - Updated installation instructions
- [x] `sdks/rust/CONTRIBUTING.md` - Updated all references

### Example Code
- [x] `examples/express-banking/package.json` - Updated dependency
- [x] `examples/express-banking/index.js` - Updated import
- [x] `examples/rust-banking/Cargo.toml` - Updated dependency
- [x] `examples/rust-banking/src/main.rs` - Updated import
- [x] `examples/rust-banking/README.md` - Updated code examples

### Analysis Document
- [x] `PACKAGE-NAMING-ANALYSIS.md` - Comprehensive analysis with all options considered

## Migration Guide for Existing Users

### TypeScript Users

**Before**:
```typescript
import { Raceway } from '@mode-7/raceway-node';
```

**After**:
```typescript
import { Raceway } from '@mode-7/raceway';
```

**Update package.json**:
```diff
{
  "dependencies": {
-   "@mode-7/raceway-node": "^0.1.0"
+   "@mode-7/raceway": "^0.1.0"
  }
}
```

Then run:
```bash
npm install
```

### Rust Users

**Before**:
```toml
[dependencies]
raceway-sdk = "0.1"
```

**After**:
```toml
[dependencies]
raceway = "0.1"
```

**Update imports**:
```diff
- use raceway_sdk::RacewayClient;
+ use raceway::RacewayClient;
```

### Python & Go Users

No changes required! 🎉

## Breaking Change Impact

- **TypeScript**: Low - Simple find-replace for existing users
- **Rust**: Low - Simple find-replace for existing users
- **Python**: None
- **Go**: None

## Publishing Checklist

Before publishing to package registries:

### npm (TypeScript)
- [ ] Verify package builds: `cd sdks/typescript && npm run build`
- [ ] Verify tests pass: `npm test`
- [ ] Login to npm: `npm login` (as `mode-7`)
- [ ] Publish: `npm publish --access public`
- [ ] Verify published: `npm info @mode-7/raceway`

### crates.io (Rust)
- [ ] Verify crate builds: `cd sdks/rust && cargo build --release`
- [ ] Verify tests pass: `cargo test`
- [ ] Login to crates.io: `cargo login`
- [ ] Publish: `cargo publish`
- [ ] Verify published: `cargo search raceway`

### PyPI (Python)
- [ ] Install build tools: `python3 -m pip install build twine`
- [ ] Build package: `cd sdks/python && python3 -m build`
- [ ] Verify build: `twine check dist/*`
- [ ] Login to PyPI: `twine upload dist/*`
- [ ] Verify published: `pip search raceway` or visit PyPI

## Post-Release Tasks

- [ ] Update GitHub release notes with migration guide
- [ ] Announce name changes in release notes
- [ ] Update any external documentation or blog posts
- [ ] Add package badges to README:
  - npm: `[![npm](https://img.shields.io/npm/v/@mode-7/raceway)](https://www.npmjs.com/package/@mode-7/raceway)`
  - PyPI: `[![PyPI](https://img.shields.io/pypi/v/raceway)](https://pypi.org/project/raceway/)`
  - crates.io: `[![Crates.io](https://img.shields.io/crates/v/raceway)](https://crates.io/crates/raceway)`

## Verification Commands

Verify all package names are consistent:

```bash
# Check TypeScript package name
grep '"name":' sdks/typescript/package.json

# Check Rust package name
grep '^name = ' sdks/rust/Cargo.toml

# Check Python package name
grep '^name = ' sdks/python/pyproject.toml

# Check examples use correct names
grep -r '@mode-7/raceway' examples/express-banking/
grep -r 'use raceway::' examples/rust-banking/
```

All checks should show the new simplified names.

## Benefits Achieved

1. ✅ **Consistency**: 3/4 SDKs use just "raceway"
2. ✅ **Simplicity**: Shorter, more memorable package names
3. ✅ **Accuracy**: TypeScript SDK works in browsers too, not just Node
4. ✅ **Availability**: All names verified available on registries
5. ✅ **Professional**: Clean naming for long-term maintenance

## Future Considerations

- Monitor user feedback on the simplified naming
- If acquiring `@raceway` npm scope becomes possible, consider:
  - `@raceway/typescript` or just `@raceway` for universal package
  - Would provide even more consistency across ecosystems
